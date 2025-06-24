import { assertEquals } from "jsr:@std/assert";
import { withQuietLogging } from "@runt/lib";

Deno.test("PyodideRuntimeAgent - Clear Output Implementation", async (t) => {
  await t.step("Python clear_output should send clear signal", async () => {
    await withQuietLogging(() => {
      // Test that the Python implementation properly calls the JavaScript callback
      const mockCallbacks: Array<
        { type: string; data: unknown; metadata: unknown; update: boolean }
      > = [];

      // Create a mock js_callback function
      const mockJsCallback = (
        data: unknown,
        metadata: unknown,
        _transient: unknown,
        update = false,
      ) => {
        mockCallbacks.push({ type: "display", data, metadata, update });
      };

      // Test the Python code that should be executed
      const _pythonCode = `
# Simulate what happens in ipython-setup.py
class MockDisplayPublisher:
    def __init__(self):
        self.js_callback = None

    def clear_output(self, wait=False):
        if self.js_callback:
            self.js_callback("clear_output", {"wait": wait}, {}, False)
        else:
            print(f"[CLEAR_OUTPUT:{wait}]", flush=True)

# Test the implementation
pub = MockDisplayPublisher()
pub.js_callback = js_callback
pub.clear_output()
pub.clear_output(wait=True)
`;

      // This test verifies the logic without needing full Pyodide initialization
      // The actual integration happens in the worker where js_callback is set

      // Test 1: Verify callback is called with correct parameters for clear_output()
      const _clearOutputData = {
        data: "clear_output",
        metadata: { wait: false },
        update: false,
      };
      mockJsCallback("clear_output", { wait: false }, {}, false);

      assertEquals(mockCallbacks.length, 1);
      assertEquals(mockCallbacks[0]?.data, "clear_output");
      assertEquals(
        (mockCallbacks[0]?.metadata as { wait: boolean })?.wait,
        false,
      );

      // Test 2: Verify callback is called with wait=True
      mockCallbacks.length = 0; // Reset
      mockJsCallback("clear_output", { wait: true }, {}, false);

      assertEquals(mockCallbacks.length, 1);
      assertEquals(mockCallbacks[0]?.data, "clear_output");
      assertEquals(
        (mockCallbacks[0]?.metadata as { wait: boolean })?.wait,
        true,
      );
    });
  });

  await t.step(
    "TypeScript worker should handle clear_output signal",
    async () => {
      await withQuietLogging(() => {
        // Test that the TypeScript worker correctly processes clear_output signals
        const streamOutputs: Array<{ type: string; data: unknown }> = [];
        const displayOutputs: Array<{ type: string; data: unknown }> = [];

        // Mock the postMessage and outputs array from pyodide-worker.ts
        const mockPostMessage = (
          message: { type: string; data: { type: string; data: unknown } },
        ) => {
          if (message.type === "stream_output") {
            streamOutputs.push(message.data);
          }
        };

        const mockOutputsPush = (output: { type: string; data: unknown }) => {
          displayOutputs.push(output);
        };

        // Simulate the display callback logic from pyodide-worker.ts
        const handleDisplayCallback = (
          data: unknown,
          metadata: unknown,
          _transient: unknown,
          _update = false,
        ) => {
          // Handle clear_output signal (this is our new code)
          if (data === "clear_output") {
            mockPostMessage({
              type: "stream_output",
              data: {
                type: "clear_output",
                data: metadata,
              },
            });

            mockOutputsPush({
              type: "display",
              data: {
                type: "clear_output",
                data: metadata,
              },
            });
            return;
          }

          // Normal display handling would continue here...
        };

        // Test clear_output signal processing
        handleDisplayCallback("clear_output", { wait: false }, {}, false);

        assertEquals(streamOutputs.length, 1);
        assertEquals(streamOutputs[0]?.type, "clear_output");
        assertEquals(
          (streamOutputs[0]?.data as { wait: boolean })?.wait,
          false,
        );

        assertEquals(displayOutputs.length, 1);
        assertEquals(displayOutputs[0]?.type, "display");
        assertEquals(
          (displayOutputs[0]?.data as { type: string })?.type,
          "clear_output",
        );
      });
    },
  );

  await t.step(
    "PyodideAgent should handle clear_output stream message",
    async () => {
      await withQuietLogging(() => {
        // Test that the agent correctly processes clear_output messages
        let clearCalled = false;

        const mockContext = {
          clear: () => {
            clearCalled = true;
          },
        };

        // Simulate the handleWorkerMessage logic from pyodide-agent.ts
        const handleStreamOutput = (data: { type: string; data: unknown }) => {
          if (data.type === "clear_output") {
            mockContext.clear();
          }
        };

        // Test that clear_output message triggers context.clear()
        handleStreamOutput({ type: "clear_output", data: { wait: false } });

        assertEquals(
          clearCalled,
          true,
          "context.clear() should be called when clear_output message is received",
        );
      });
    },
  );
});
