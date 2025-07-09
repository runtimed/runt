import {
  discoverAvailableAiModels,
  filterModelsByCapabilities,
} from "./mod.ts";

/**
 * Demo script to test AI model discovery functionality
 */
async function demo() {
  console.log("🚀 AI Model Discovery Demo\n");

  try {
    // Discover all available models
    console.log("📡 Discovering available AI models...");
    const allModels = await discoverAvailableAiModels();

    console.log(`\n✅ Found ${allModels.length} total models:\n`);

    // Group models by provider
    const modelsByProvider = new Map<string, typeof allModels>();
    for (const model of allModels) {
      if (!modelsByProvider.has(model.provider)) {
        modelsByProvider.set(model.provider, []);
      }
      modelsByProvider.get(model.provider)!.push(model);
    }

    // Display models by provider
    for (const [provider, models] of modelsByProvider) {
      console.log(`📦 ${provider.toUpperCase()} Models (${models.length}):`);

      for (const model of models) {
        const capabilities = model.capabilities.join(", ");
        const metadata = model.metadata?.parameterSize
          ? ` (${model.metadata.parameterSize})`
          : "";

        console.log(`  • ${model.displayName}${metadata}`);
        console.log(`    ID: ${model.name}`);
        console.log(`    Capabilities: ${capabilities}`);
        console.log("");
      }
    }

    // Filter models with tool calling capabilities
    console.log("🔧 Models with tool calling capabilities:");
    const toolCapableModels = filterModelsByCapabilities(allModels, ["tools"]);

    if (toolCapableModels.length === 0) {
      console.log("  No models found with tool calling capabilities");
    } else {
      for (const model of toolCapableModels) {
        const metadata = model.metadata?.parameterSize
          ? ` (${model.metadata.parameterSize})`
          : "";
        console.log(`  • ${model.displayName}${metadata} - ${model.provider}`);
      }
    }

    // Filter models with vision capabilities
    console.log("\n👁️ Models with vision capabilities:");
    const visionCapableModels = filterModelsByCapabilities(allModels, [
      "vision",
    ]);

    if (visionCapableModels.length === 0) {
      console.log("  No models found with vision capabilities");
    } else {
      for (const model of visionCapableModels) {
        const metadata = model.metadata?.parameterSize
          ? ` (${model.metadata.parameterSize})`
          : "";
        console.log(`  • ${model.displayName}${metadata} - ${model.provider}`);
      }
    }

    // Filter models with both tools and vision
    console.log("\n🎯 Models with both tools AND vision:");
    const multiCapableModels = filterModelsByCapabilities(allModels, [
      "tools",
      "vision",
    ]);

    if (multiCapableModels.length === 0) {
      console.log(
        "  No models found with both tool calling and vision capabilities",
      );
    } else {
      for (const model of multiCapableModels) {
        const metadata = model.metadata?.parameterSize
          ? ` (${model.metadata.parameterSize})`
          : "";
        console.log(`  • ${model.displayName}${metadata} - ${model.provider}`);
      }
    }

    // Show statistics
    console.log("\n📊 Statistics:");
    console.log(`  Total models: ${allModels.length}`);
    console.log(`  Providers: ${modelsByProvider.size}`);
    console.log(`  With tools: ${toolCapableModels.length}`);
    console.log(`  With vision: ${visionCapableModels.length}`);
    console.log(`  With both: ${multiCapableModels.length}`);
  } catch (error) {
    console.error("❌ Error during model discovery:", error);
  }
}

// Run the demo
if (import.meta.main) {
  demo().catch(console.error);
}
