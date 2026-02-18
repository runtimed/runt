import { act, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { OutputWidget } from "@/components/widgets/controls/output-widget";
import {
  WidgetStoreContext,
} from "@/components/widgets/widget-store-context";
import { createWidgetStore } from "@/components/widgets/widget-store";

describe("OutputWidget", () => {
  beforeAll(() => {
    if (!window.matchMedia) {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
          media: query,
          matches: false,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }),
      });
    }
  });

  it("renders output messages received via custom comm messages", async () => {
    const store = createWidgetStore();
    store.createModel("output-1", {
      _model_name: "OutputModel",
      _model_module: "@jupyter-widgets/output",
      outputs: [],
    });

    render(
      <WidgetStoreContext.Provider
        value={{
          store,
          handleMessage: () => {},
          sendMessage: () => {},
          sendUpdate: () => {},
          sendCustom: () => {},
          closeComm: () => {},
        }}
      >
        <OutputWidget modelId="output-1" />
      </WidgetStoreContext.Provider>
    );

    await act(async () => {});

    act(() => {
      store.emitCustomMessage("output-1", {
        method: "output",
        output: {
          output_type: "stream",
          name: "stdout",
          text: "Clicked!",
        },
      });
    });

    expect(await screen.findByText("Clicked!")).toBeInTheDocument();
  });

  it("supports clear_output(wait=true) semantics", async () => {
    const store = createWidgetStore();
    store.createModel("output-1", {
      _model_name: "OutputModel",
      _model_module: "@jupyter-widgets/output",
      outputs: [],
    });

    render(
      <WidgetStoreContext.Provider
        value={{
          store,
          handleMessage: () => {},
          sendMessage: () => {},
          sendUpdate: () => {},
          sendCustom: () => {},
          closeComm: () => {},
        }}
      >
        <OutputWidget modelId="output-1" />
      </WidgetStoreContext.Provider>
    );

    await act(async () => {});

    act(() => {
      store.emitCustomMessage("output-1", {
        method: "output",
        output: {
          output_type: "stream",
          name: "stdout",
          text: "First",
        },
      });
      store.emitCustomMessage("output-1", {
        method: "clear_output",
        wait: true,
      });
      store.emitCustomMessage("output-1", {
        method: "output",
        output: {
          output_type: "stream",
          name: "stdout",
          text: "Second",
        },
      });
    });

    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("First")).not.toBeInTheDocument();
  });
});
