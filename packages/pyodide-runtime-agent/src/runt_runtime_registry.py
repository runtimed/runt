"""Registry of functions.

Original from https://github.com/rgbkrk/chatlab/blob/main/chatlab/registry.py
"""

import asyncio
import inspect
import json

from typing import (
    Any,
    Callable,
    Dict,
    Iterable,
    List,
    Optional,
    Type,
    TypeAlias,
    TypedDict,
    Required,
    Union,
    cast,
    get_args,
    get_origin,
    overload,
)

from pydantic import BaseModel, Field, create_model

FunctionParameters: TypeAlias = Dict[str, object]


class FunctionDefinition(TypedDict, total=False):
    name: Required[str]
    """The name of the function to be called.

    Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length
    of 64.
    """

    description: str
    """
    A description of what the function does, used by the model to choose when and
    how to call the function.
    """

    parameters: FunctionParameters
    """The parameters the functions accepts, described as a JSON Schema object.

    See the [guide](https://platform.openai.com/docs/guides/function-calling) for
    examples, and the
    [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for
    documentation about the format.

    Omitting `parameters` defines a function with an empty parameter list.
    """

    strict: Optional[bool]
    """Whether to enable strict schema adherence when generating the function call.

    If set to true, the model will follow the exact schema defined in the
    `parameters` field. Only a subset of JSON Schema is supported when `strict` is
    `true`. Learn more about Structured Outputs in the
    [function calling guide](https://platform.openai.com/docs/guides/function-calling).
    """


class FunctionError(Exception):
    """Exception raised when a function encounters an error."""

    pass


class FunctionArgumentError(FunctionError):
    """Exception raised when a function is called with invalid arguments."""

    pass


class UnknownFunctionError(FunctionError):
    """Exception raised when a function is called that is not registered."""

    pass


# Allowed types for auto-inferred schemas
ALLOWED_TYPES = [int, str, bool, float, list, dict, List, Dict]

JSON_SCHEMA_TYPES = {
    int: "integer",
    float: "number",
    str: "string",
    bool: "boolean",
    list: "array",
    dict: "object",
    List: "array",
    Dict: "object",
}


def is_optional_type(t):
    """Check if a type is Optional."""
    return (
        get_origin(t) is Union and len(get_args(t)) == 2 and type(None) in get_args(t)
    )


def is_union_type(t):
    """Check if a type is a Union."""
    return get_origin(t) is Union


class FunctionSchemaConfig:
    """Config used for model generation during function schema creation."""

    arbitrary_types_allowed = True


def extract_model_from_function(func_name: str, function: Callable) -> Type[BaseModel]:
    # extract function parameters and their type annotations
    sig = inspect.signature(function)

    fields = {}
    required_fields = []
    for name, param in sig.parameters.items():
        # skip 'self' for class methods
        if name == "self":
            continue

        # determine type annotation
        if param.annotation == inspect.Parameter.empty:
            # no annotation, raise instead of falling back to Any
            raise Exception(
                f"`{name}` parameter of {func_name} must have a JSON-serializable type annotation"
            )
        type_annotation = param.annotation

        default_value: Any = ...

        # determine if there is a default value
        if param.default != inspect.Parameter.empty:
            default_value = param.default
        else:
            required_fields.append(name)

        # Check if the annotation is Union that includes None, indicating an optional parameter
        if get_origin(type_annotation) is Union:
            args = get_args(type_annotation)
            if len(args) == 2 and type(None) in args:
                type_annotation = next(arg for arg in args if arg is not type(None))
                default_value = None

        fields[name] = (
            type_annotation,
            Field(default=default_value) if default_value is not ... else ...,
        )

    model = create_model(
        function.__name__,
        __config__=FunctionSchemaConfig,  # type: ignore
        **fields,  # type: ignore
    )
    return model


def generate_function_schema(
    function: Callable,
    parameter_schema: Optional[Union[Type["BaseModel"], dict]] = None,
) -> FunctionDefinition:
    """Generate a function schema for sending to OpenAI."""
    doc = function.__doc__
    func_name = function.__name__

    if not func_name:
        raise Exception("Function must have a name")
    if func_name == "<lambda>":
        raise Exception("Lambdas cannot be registered. Use `def` instead.")
    if not doc:
        raise Exception("Only functions with docstrings can be registered")

    if isinstance(parameter_schema, dict):
        parameters = parameter_schema
    elif parameter_schema is not None:
        parameters = parameter_schema.model_json_schema()  # type: ignore
    else:
        model = extract_model_from_function(func_name, function)
        parameters: dict = model.model_json_schema()  # type: ignore

    if "properties" not in parameters:
        parameters["properties"] = {}

    # remove "title" since it's unused by OpenAI
    parameters.pop("title", None)
    for field_name in parameters["properties"].keys():
        parameters["properties"][field_name].pop("title", None)

    if "required" not in parameters:
        parameters["required"] = []

    schema = FunctionDefinition(
        name=func_name,
        description=doc,
        parameters=parameters,
    )
    return schema


class FunctionRegistry:
    """Registry of functions and their schemas for calling them."""

    __functions: dict[str, Callable]
    __schemas: dict[str, FunctionDefinition]

    # Allow passing in a callable that accepts a single string for the python
    # hallucination function. This is useful for testing.
    def __init__(
        self,
    ):
        """Initialize a FunctionRegistry object."""
        self.__functions = {}
        self.__schemas = {}

    def decorator(
        self, parameter_schema: Optional[Union[Type["BaseModel"], dict]] = None
    ) -> Callable:
        """Create a decorator for registering functions with a schema."""

        def decorator(function):
            self.register_function(function, parameter_schema)
            return function

        return decorator

    @overload
    def register(
        self,
        function: None = None,
        parameter_schema: Optional[Union[Type["BaseModel"], dict]] = None,
    ) -> Callable: ...

    @overload
    def register(
        self,
        function: Callable,
        parameter_schema: Optional[Union[Type["BaseModel"], dict]] = None,
    ) -> FunctionDefinition: ...

    def register(
        self,
        function: Optional[Callable] = None,
        parameter_schema: Optional[Union[Type["BaseModel"], dict]] = None,
    ) -> Union[Callable, FunctionDefinition]:
        """Register a function. Can be used as a decorator or directly to register a function.

        >>> registry = FunctionRegistry()
        >>> @registry.register
        ... def what_time(tz: Optional[str] = None):
        ...     '''Current time, defaulting to the user's current timezone'''
        ...     if tz is None:
        ...         pass
        ...     elif tz in all_timezones:
        ...         tz = timezone(tz)
        ...     else:
        ...         return 'Invalid timezone'
        ...     return datetime.now(tz).strftime('%I:%M %p')
        >>> registry.get("what_time")
        <function __main__.what_time(tz: Optional[str] = None)>
        >>> await registry.call("what_time", '{"tz": "America/New_York"}')
        '10:57 AM'

        """
        # If the function is None, assume this is a decorator call
        if function is None:
            return self.decorator(parameter_schema)

        # Otherwise, directly register the function
        return self.register_function(function, parameter_schema)

    def register_function(
        self,
        function: Callable,
        parameter_schema: Optional[Union[Type["BaseModel"], dict]] = None,
    ) -> FunctionDefinition:
        """Register a single function."""
        final_schema = generate_function_schema(function, parameter_schema)

        self.__functions[function.__name__] = function
        self.__schemas[function.__name__] = final_schema

        return final_schema

    def register_functions(
        self, functions: Union[Iterable[Callable], dict[str, Callable]]
    ):
        """Register a dictionary of functions."""
        if isinstance(functions, dict):
            functions = functions.values()

        for function in functions:
            self.register(function)

    def get(self, function_name) -> Optional[Callable]:
        """Get a function by name."""
        return self.__functions.get(function_name)

    def get_schema(self, function_name) -> Optional[FunctionDefinition]:
        """Get a function schema by name."""
        return self.__schemas.get(function_name)

    async def call(self, name: str, arguments: Optional[str] = None) -> Any:
        """Call a function by name with the given parameters."""
        if name is None:
            raise UnknownFunctionError("Function name must be provided")

        possible_function = self.get(name)

        if possible_function is None:
            raise UnknownFunctionError(f"Function {name} is not registered")

        function = possible_function

        # TODO: Use the model extractor here
        prepared_arguments = extract_arguments(name, function, arguments)

        if asyncio.iscoroutinefunction(function):
            result = await function(**prepared_arguments)
        else:
            result = function(**prepared_arguments)
        return result

    def __contains__(self, name) -> bool:
        """Check if a function is registered by name."""
        return name in self.__functions

    @property
    def function_definitions(self) -> list[FunctionDefinition]:
        """Get a list of function definitions."""
        return list(self.__schemas.values())


def extract_arguments(name: str, function: Callable, arguments: Optional[str]) -> dict:
    print(
        f"[DEBUG extract_arguments] name={name}, arguments={arguments!r}, type={type(arguments)}"
    )
    dict_arguments = {}
    if arguments is not None and arguments != "":
        try:
            dict_arguments = json.loads(arguments)
            print(
                f"[DEBUG extract_arguments] After JSON parsing: dict_arguments={dict_arguments!r}, type={type(dict_arguments)}"
            )
        except json.JSONDecodeError as e:
            print(f"[DEBUG extract_arguments] JSON decode error: {e}")
            raise FunctionArgumentError(
                f"Invalid Function call on {name}. Arguments must be a valid JSON object"
            )

    prepared_arguments = {}

    for param_name, param in inspect.signature(function).parameters.items():
        param_type = param.annotation
        print(
            f"[DEBUG extract_arguments] Processing param {param_name}, dict_arguments type={type(dict_arguments)}"
        )
        arg_value = dict_arguments.get(param_name)

        # Check if parameter type is a subclass of BaseModel and deserialize JSON into Pydantic model
        if inspect.isclass(param_type) and issubclass(param_type, BaseModel):
            prepared_arguments[param_name] = param_type.model_validate(arg_value)
        else:
            prepared_arguments[param_name] = cast(Any, arg_value)

    return prepared_arguments


# Create the global function registry instance
function_registry = FunctionRegistry()


class ToolNotFoundError(Exception):
    """Compatibility alias for UnknownFunctionError"""

    pass


def tool(func) -> Callable:
    """Decorator to register a function as a tool using the registry system"""
    try:
        function_registry.register(func)
        return func
    except Exception as e:
        print(f"Error registering tool {func.__name__}: {e}")
        raise


def get_registered_tools():
    """Get all registered tools as JSON string (compatible with existing API)"""
    import json

    print(
        f"[DEBUG] Registry has {len(function_registry.function_definitions)} function definitions"
    )

    # Convert FunctionDefinition format to NotebookTool format
    tools = []
    for i, definition in enumerate(function_registry.function_definitions):
        print(f"[DEBUG] Processing definition {i}: {definition}")

        # Return the function definition directly (NotebookTool format)
        tool_spec = {
            "name": definition["name"],
            "description": definition.get("description", ""),
            "parameters": definition.get("parameters", {}),
        }
        print(f"[DEBUG] Created tool_spec {i}: {tool_spec}")
        tools.append(tool_spec)

    print(f"[DEBUG] Final tools array: {tools}")
    result = json.dumps(tools, default=str)
    print(f"[DEBUG] JSON result: {result}")
    return result


async def run_registered_tool(toolName: str, kwargs_string: str):
    """Run a registered tool by name"""
    try:
        # Pass JSON string directly to registry
        result = await function_registry.call(toolName, kwargs_string)

        # Ensure result is JSON serializable string
        if not isinstance(result, str):
            result = json.dumps(result, default=str)

        return result

    except UnknownFunctionError:
        raise ToolNotFoundError(f"Tool {toolName} not found")
    except (FunctionArgumentError, FunctionError) as e:
        # Log the error for debugging
        print(f"[TOOL_ERROR] Error running tool {toolName}: {e}")
        raise
    except Exception as e:
        # Capture and format any other Python exceptions from tool execution
        import traceback
        import sys

        # Format the full traceback for debugging
        tb_str = traceback.format_exc()
        error_msg = f"Tool '{toolName}' execution failed with error: {str(e)}"

        # Print the full traceback to stderr for logging
        print(f"[TOOL_ERROR] {error_msg}", file=sys.stderr)
        print(f"[TOOL_TRACEBACK] {tb_str}", file=sys.stderr)

        # Raise a clear error that includes the Python error details
        raise Exception(f"{error_msg}\n\nPython traceback:\n{tb_str}")
