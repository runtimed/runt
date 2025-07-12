#!/usr/bin/env python3
"""
Phase 2 Binary Upload Validation Test

This script tests the Phase 2 direct binary upload functionality for the artifact system.
It demonstrates the difference between the old base64 approach and the new binary upload API.

Run this in a notebook cell to validate Phase 2 implementation.
"""

import matplotlib.pyplot as plt
import numpy as np
import io
import base64
import asyncio


def test_phase2_binary_upload():
    """Test the Phase 2 binary upload functionality"""

    print("🧪 Phase 2 Binary Upload Validation Test")
    print("=" * 50)

    # Generate test data for binary upload
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    x = np.linspace(0, 10, 1000)

    for i, ax in enumerate(axes.flat):
        y = np.sin(x + i) * np.exp(-x / 5)
        ax.plot(x, y, linewidth=2, label=f"Function {i + 1}")
        ax.set_title(f"Phase 2 Test Plot {i + 1}")
        ax.grid(True, alpha=0.3)
        ax.legend()

    plt.tight_layout()
    plt.suptitle("Phase 2 Binary Upload Test - Large Plot", fontsize=16, y=0.98)

    # Get PNG data
    png_buffer = io.BytesIO()
    fig.savefig(png_buffer, format="png", dpi=150, bbox_inches="tight")
    png_data = png_buffer.getvalue()
    png_buffer.close()

    print(f"📊 Generated PNG data: {len(png_data)} bytes")
    print(f"📏 Size threshold: {artifact.threshold} bytes")
    print(f"🔄 Should use binary upload: {len(png_data) > artifact.threshold}")

    # Test 1: Check if Phase 2 API is available
    print("\n🔧 Test 1: Phase 2 API Availability")
    try:
        import js

        has_binary_upload = hasattr(js, "js_upload_binary")
        has_upload_if_needed = hasattr(js, "js_upload_if_needed")
        has_display_artifact = hasattr(js, "js_display_artifact")

        print(f"   js_upload_binary: {'✅' if has_binary_upload else '❌'}")
        print(f"   js_upload_if_needed: {'✅' if has_upload_if_needed else '❌'}")
        print(f"   js_display_artifact: {'✅' if has_display_artifact else '❌'}")

        if has_binary_upload and has_upload_if_needed and has_display_artifact:
            print("   🎉 Phase 2 API is available!")
        else:
            print("   ⚠️ Phase 2 API not fully available, using fallback")
            return test_fallback_behavior(png_data)

    except ImportError:
        print("   ❌ JavaScript bridge not available")
        return test_fallback_behavior(png_data)

    # Test 2: Direct binary upload
    print("\n🚀 Test 2: Direct Binary Upload")

    async def test_binary_upload():
        try:
            metadata = {
                "source": "phase2-test",
                "width": int(fig.get_figwidth() * fig.dpi),
                "height": int(fig.get_figheight() * fig.dpi),
                "test": True,
            }

            artifact_id = await artifact.upload_binary(png_data, "image/png", metadata)
            print(f"   ✅ Binary upload successful!")
            print(f"   📁 Artifact ID: {artifact_id}")
            print(f"   📈 Size: {len(png_data)} bytes (binary)")

            # Compare to base64 size
            base64_size = len(base64.b64encode(png_data))
            overhead = ((base64_size - len(png_data)) / len(png_data)) * 100
            print(
                f"   📉 Base64 would be: {base64_size} bytes ({overhead:.1f}% overhead)"
            )

            return artifact_id

        except Exception as e:
            print(f"   ❌ Binary upload failed: {e}")
            return None

    # Test 3: Smart upload decision
    print("\n🧠 Test 3: Smart Upload Decision")

    async def test_smart_upload():
        try:
            container = await artifact.upload_if_needed(png_data, "image/png")
            print(f"   📦 Container type: {container['type']}")

            if container["type"] == "artifact":
                print(f"   ✅ Large data correctly uploaded as artifact")
                print(f"   📁 Artifact ID: {container.get('artifactId', 'N/A')}")
            else:
                print(f"   ⚠️ Data kept inline (unexpected for large image)")

            return container

        except Exception as e:
            print(f"   ❌ Smart upload failed: {e}")
            return None

    # Test 4: Display artifact
    print("\n🖼️ Test 4: Display Artifact")

    async def test_display():
        try:
            # Upload first
            artifact_id = await artifact.upload_binary(png_data, "image/png")

            # Display using Phase 2 API
            display_artifact(
                artifact_id,
                "image/png",
                {"caption": "Phase 2 Binary Upload Test", "test_phase": 2},
            )

            print(f"   ✅ Artifact displayed successfully!")
            print(f"   📁 Artifact ID: {artifact_id}")

        except Exception as e:
            print(f"   ❌ Display artifact failed: {e}")

    # Run async tests
    async def run_all_tests():
        print("\n⏳ Running async tests...")

        artifact_id = await test_binary_upload()
        container = await test_smart_upload()
        await test_display()

        return artifact_id, container

    # Execute tests
    try:
        artifact_id, container = asyncio.run(run_all_tests())

        print("\n📋 Test Summary:")
        print(f"   Binary Upload: {'✅' if artifact_id else '❌'}")
        print(f"   Smart Upload: {'✅' if container else '❌'}")
        print(f"   PNG Size: {len(png_data)} bytes")
        print(f"   Threshold: {artifact.threshold} bytes")

        if artifact_id:
            print(f"   🎯 Phase 2 binary upload working correctly!")
        else:
            print(f"   ⚠️ Phase 2 binary upload needs debugging")

    except Exception as e:
        print(f"\n❌ Test execution failed: {e}")
        return test_fallback_behavior(png_data)

    # Clean up
    plt.close(fig)

    print("\n🏁 Phase 2 validation complete!")


def test_fallback_behavior(png_data):
    """Test the fallback behavior when Phase 2 API is not available"""
    print("\n🔄 Testing Fallback Behavior")

    # This should use the old base64 approach
    from IPython.display import Image, display

    print(f"   📊 PNG size: {len(png_data)} bytes")
    base64_data = base64.b64encode(png_data).decode("ascii")
    print(f"   📈 Base64 size: {len(base64_data)} bytes")
    overhead = ((len(base64_data) - len(png_data)) / len(png_data)) * 100
    print(f"   📉 Overhead: {overhead:.1f}%")

    # Display using traditional IPython method
    display(Image(data=png_data))
    print("   ✅ Fallback display successful")


def test_small_image():
    """Test behavior with small images that should stay inline"""
    print("\n🔬 Testing Small Image Behavior")

    # Create a small 50x50 image
    small_fig, ax = plt.subplots(figsize=(1, 1))
    ax.plot([0, 1], [0, 1], "r-")
    ax.set_title("Small")

    small_buffer = io.BytesIO()
    small_fig.savefig(small_buffer, format="png", dpi=50)
    small_data = small_buffer.getvalue()
    small_buffer.close()

    print(f"   📏 Small image size: {len(small_data)} bytes")
    print(f"   🎯 Should stay inline: {len(small_data) <= artifact.threshold}")

    # Test smart upload decision
    async def test_small():
        try:
            container = await artifact.upload_if_needed(small_data, "image/png")
            print(f"   📦 Container type: {container['type']}")

            if container["type"] == "inline":
                print("   ✅ Small image correctly kept inline")
            else:
                print("   ⚠️ Small image unexpectedly uploaded as artifact")

        except Exception as e:
            print(f"   ❌ Small image test failed: {e}")

    try:
        asyncio.run(test_small())
    except Exception as e:
        print(f"   ❌ Could not test small image: {e}")

    plt.close(small_fig)


def demonstrate_phase2_benefits():
    """Demonstrate the benefits of Phase 2 implementation"""
    print("\n🎁 Phase 2 Benefits Demonstration")
    print("=" * 40)

    # Create various sized test data
    sizes = [1024, 8192, 16384, 32768, 65536]  # 1KB to 64KB

    for size in sizes:
        test_data = b"X" * size
        base64_size = len(base64.b64encode(test_data))
        overhead = ((base64_size - size) / size) * 100

        print(f"   {size:5d} bytes → {base64_size:5d} bytes (+{overhead:4.1f}%)")

    print("\n📈 Phase 2 Improvements:")
    print("   • Eliminates 33% base64 overhead")
    print("   • Stores actual binary data in artifacts")
    print("   • Faster upload/download operations")
    print("   • Better memory efficiency")
    print("   • Native browser image handling")


# Run the comprehensive test
if __name__ == "__main__":
    print("🚀 Starting Phase 2 Binary Upload Validation")
    print("=" * 60)

    # Main test
    test_phase2_binary_upload()

    # Additional tests
    test_small_image()
    demonstrate_phase2_benefits()

    print("\n" + "=" * 60)
    print("🏆 Phase 2 validation test complete!")
    print("\nIf you see artifact uploads working and images displaying correctly,")
    print("then Phase 2 direct binary upload is functioning properly!")
