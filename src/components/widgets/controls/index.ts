import { registerWidget } from "../widget-registry";
import { AccordionWidget } from "./accordion-widget";
import { AudioWidget } from "./audio-widget";
import { BoundedFloatTextWidget } from "./bounded-float-text-widget";
import { BoundedIntTextWidget } from "./bounded-int-text-widget";
import { BoxWidget } from "./box-widget";
import { ButtonWidget } from "./button-widget";
import { CheckboxWidget } from "./checkbox-widget";
import { ColorPicker } from "./color-picker";
import { ColorsInputWidget } from "./colors-input-widget";
import { ComboboxWidget } from "./combobox-widget";
import { ControllerAxisWidget } from "./controller-axis-widget";
import { ControllerButtonWidget } from "./controller-button-widget";
import { ControllerWidget } from "./controller-widget";
import { DatePickerWidget } from "./date-picker-widget";
import { DatetimeWidget } from "./datetime-widget";
// Selection widgets
import { DropdownWidget } from "./dropdown-widget";
import { FileUploadWidget } from "./file-upload-widget";
import { FloatLogSlider } from "./float-log-slider";
import { FloatProgress } from "./float-progress";
import { FloatRangeSlider } from "./float-range-slider";
import { FloatSlider } from "./float-slider";
import { FloatTextWidget } from "./float-text-widget";
import { FloatsInputWidget } from "./floats-input-widget";
import { GridBoxWidget } from "./gridbox-widget";
import { HBoxWidget } from "./hbox-widget";
import { HTMLMathWidget } from "./html-math-widget";
import { HTMLWidget } from "./html-widget";
import { ImageWidget } from "./image-widget";
import { IntProgress } from "./int-progress";
import { IntRangeSlider } from "./int-range-slider";
// Import widget components
import { IntSlider } from "./int-slider";
import { IntTextWidget } from "./int-text-widget";
import { IntsInputWidget } from "./ints-input-widget";
import { LabelWidget } from "./label-widget";
import { DirectionalLinkWidget, LinkWidget } from "./link-widget";
import { OutputWidget } from "./output-widget";
import { PasswordWidget } from "./password-widget";
import { PlayWidget } from "./play-widget";
import { RadioButtonsWidget } from "./radio-buttons-widget";
import { SelectMultipleWidget } from "./select-multiple-widget";
import { SelectWidget } from "./select-widget";
import { SelectionRangeSliderWidget } from "./selection-range-slider-widget";
import { SelectionSliderWidget } from "./selection-slider-widget";
import { StackWidget } from "./stack-widget";
import { TabWidget } from "./tab-widget";
import { TagsInputWidget } from "./tags-input-widget";
import { TextWidget } from "./text-widget";
import { TextareaWidget } from "./textarea-widget";
import { TimePickerWidget } from "./time-picker-widget";
import { ToggleButtonWidget } from "./toggle-button-widget";
import { ToggleButtonsWidget } from "./toggle-buttons-widget";
import { ValidWidget } from "./valid-widget";
// Import layout widget components
import { VBoxWidget } from "./vbox-widget";
import { VideoWidget } from "./video-widget";

// Register all widgets with their model names
registerWidget("IntSliderModel", IntSlider);
registerWidget("FloatSliderModel", FloatSlider);
registerWidget("FloatLogSliderModel", FloatLogSlider);
registerWidget("IntRangeSliderModel", IntRangeSlider);
registerWidget("FloatRangeSliderModel", FloatRangeSlider);
registerWidget("SelectionSliderModel", SelectionSliderWidget);
registerWidget("SelectionRangeSliderModel", SelectionRangeSliderWidget);
registerWidget("IntProgressModel", IntProgress);
registerWidget("FloatProgressModel", FloatProgress);
registerWidget("ButtonModel", ButtonWidget);
registerWidget("PlayModel", PlayWidget);
registerWidget("CheckboxModel", CheckboxWidget);
registerWidget("TextModel", TextWidget);
registerWidget("TextareaModel", TextareaWidget);
registerWidget("HTMLModel", HTMLWidget);
registerWidget("HTMLMathModel", HTMLMathWidget);
registerWidget("LabelModel", LabelWidget);
registerWidget("ImageModel", ImageWidget);
registerWidget("AudioModel", AudioWidget);
registerWidget("VideoModel", VideoWidget);
registerWidget("ColorPickerModel", ColorPicker);
registerWidget("DatePickerModel", DatePickerWidget);
registerWidget("DatetimeModel", DatetimeWidget);
registerWidget("NaiveDatetimeModel", DatetimeWidget);
registerWidget("TimePickerModel", TimePickerWidget);
registerWidget("TimeModel", TimePickerWidget);
// Numeric text inputs
registerWidget("IntTextModel", IntTextWidget);
registerWidget("FloatTextModel", FloatTextWidget);
registerWidget("BoundedIntTextModel", BoundedIntTextWidget);
registerWidget("BoundedFloatTextModel", BoundedFloatTextWidget);
registerWidget("PasswordModel", PasswordWidget);
registerWidget("ValidModel", ValidWidget);
// Selection widgets
registerWidget("DropdownModel", DropdownWidget);
registerWidget("ComboboxModel", ComboboxWidget);
registerWidget("RadioButtonsModel", RadioButtonsWidget);
registerWidget("SelectModel", SelectWidget);
registerWidget("SelectMultipleModel", SelectMultipleWidget);
registerWidget("ToggleButtonModel", ToggleButtonWidget);
registerWidget("ToggleButtonsModel", ToggleButtonsWidget);
// Multi-value inputs
registerWidget("TagsInputModel", TagsInputWidget);
registerWidget("ColorsInputModel", ColorsInputWidget);
registerWidget("IntsInputModel", IntsInputWidget);
registerWidget("FloatsInputModel", FloatsInputWidget);
registerWidget("FileUploadModel", FileUploadWidget);

// Link widgets (frontend-only property synchronization)
registerWidget("LinkModel", LinkWidget);
registerWidget("DirectionalLinkModel", DirectionalLinkWidget);

// Register layout widgets
registerWidget("VBoxModel", VBoxWidget);
registerWidget("HBoxModel", HBoxWidget);
registerWidget("BoxModel", BoxWidget);
registerWidget("GridBoxModel", GridBoxWidget);
registerWidget("AccordionModel", AccordionWidget);
registerWidget("TabModel", TabWidget);
registerWidget("StackModel", StackWidget);

// Controller widgets (Gamepad API)
registerWidget("ControllerModel", ControllerWidget);
registerWidget("ControllerButtonModel", ControllerButtonWidget);
registerWidget("ControllerAxisModel", ControllerAxisWidget);

// Output widget (@jupyter-widgets/output)
registerWidget("OutputModel", OutputWidget);

export { AccordionWidget } from "./accordion-widget";
export { AudioWidget } from "./audio-widget";
export { BoundedFloatTextWidget } from "./bounded-float-text-widget";
export { BoundedIntTextWidget } from "./bounded-int-text-widget";
export { BoxWidget } from "./box-widget";
export { ButtonWidget } from "./button-widget";
export { CheckboxWidget } from "./checkbox-widget";
export { ColorPicker } from "./color-picker";
export { ColorsInputWidget } from "./colors-input-widget";
export { ComboboxWidget } from "./combobox-widget";
export { ControllerAxisWidget } from "./controller-axis-widget";
export { ControllerButtonWidget } from "./controller-button-widget";
export { ControllerWidget } from "./controller-widget";
export { DatePickerWidget } from "./date-picker-widget";
export { DatetimeWidget } from "./datetime-widget";
// Selection widgets
export { DropdownWidget } from "./dropdown-widget";
export { FileUploadWidget } from "./file-upload-widget";
export { FloatLogSlider } from "./float-log-slider";
export { FloatProgress } from "./float-progress";
export { FloatRangeSlider } from "./float-range-slider";
export { FloatSlider } from "./float-slider";
export { FloatTextWidget } from "./float-text-widget";
export { FloatsInputWidget } from "./floats-input-widget";
export { GridBoxWidget } from "./gridbox-widget";
export { HBoxWidget } from "./hbox-widget";
export { HTMLMathWidget } from "./html-math-widget";
export { HTMLWidget } from "./html-widget";
export { ImageWidget } from "./image-widget";
export { IntProgress } from "./int-progress";
export { IntRangeSlider } from "./int-range-slider";
// Re-export components for direct use
export { IntSlider } from "./int-slider";
export { IntTextWidget } from "./int-text-widget";
export { IntsInputWidget } from "./ints-input-widget";
export { LabelWidget } from "./label-widget";
export { DirectionalLinkWidget, LinkWidget } from "./link-widget";
export { OutputWidget } from "./output-widget";
export { PasswordWidget } from "./password-widget";
export { PlayWidget } from "./play-widget";
export { RadioButtonsWidget } from "./radio-buttons-widget";
export { SelectMultipleWidget } from "./select-multiple-widget";
export { SelectWidget } from "./select-widget";
export { SelectionRangeSliderWidget } from "./selection-range-slider-widget";
export { SelectionSliderWidget } from "./selection-slider-widget";
export { StackWidget } from "./stack-widget";
export { TabWidget } from "./tab-widget";
export { TagsInputWidget } from "./tags-input-widget";
export { TextWidget } from "./text-widget";
export { TextareaWidget } from "./textarea-widget";
export { TimePickerWidget } from "./time-picker-widget";
export { ToggleButtonWidget } from "./toggle-button-widget";
export { ToggleButtonsWidget } from "./toggle-buttons-widget";
export { ValidWidget } from "./valid-widget";
// Re-export layout widgets
export { VBoxWidget } from "./vbox-widget";
export { VideoWidget } from "./video-widget";
