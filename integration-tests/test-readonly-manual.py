#!/usr/bin/env python3
"""
Manual test script to verify read-only mounting works correctly.
Run this with: deno run --allow-all "jsr:@runt/pyodide-runtime-agent" --mount ./test-data --mount-readonly
"""

import os
import sys

print("=== Testing Read-Only Mount Functionality ===")

# Test reading files (should work)
try:
    mount_dir = "/mnt/_test-data"
    print(f"\n1. Testing file reading from {mount_dir}:")
    
    if os.path.exists(mount_dir):
        files = os.listdir(mount_dir)
        print(f"   Found {len(files)} files: {files}")
        
        # Try to read a file if it exists
        if files:
            test_file = os.path.join(mount_dir, files[0])
            with open(test_file, 'r') as f:
                content = f.read()[:100]  # First 100 chars
                print(f"   Successfully read from {files[0]}: {content}...")
    else:
        print(f"   Mount directory {mount_dir} not found")
        
except Exception as e:
    print(f"   ERROR reading files: {e}")

# Test writing to existing files (should fail)
print(f"\n2. Testing file modification (should fail):")
try:
    if os.path.exists(mount_dir) and os.listdir(mount_dir):
        test_file = os.path.join(mount_dir, os.listdir(mount_dir)[0])
        with open(test_file, 'w') as f:
            f.write("This should fail")
        print("   ERROR: File modification should have failed!")
except (OSError, PermissionError) as e:
    print(f"   SUCCESS: File modification correctly failed: {type(e).__name__}")
except Exception as e:
    print(f"   UNEXPECTED ERROR: {e}")

# Test creating new files (should fail)
print(f"\n3. Testing new file creation (should fail):")
try:
    if os.path.exists(mount_dir):
        new_file = os.path.join(mount_dir, "new_file.txt")
        with open(new_file, 'w') as f:
            f.write("This should fail")
        print("   ERROR: New file creation should have failed!")
except (OSError, PermissionError) as e:
    print(f"   SUCCESS: New file creation correctly failed: {type(e).__name__}")
except Exception as e:
    print(f"   UNEXPECTED ERROR: {e}")

# Test creating new directories (should fail)
print(f"\n4. Testing new directory creation (should fail):")
try:
    if os.path.exists(mount_dir):
        new_dir = os.path.join(mount_dir, "new_directory")
        os.mkdir(new_dir)
        print("   ERROR: New directory creation should have failed!")
except (OSError, PermissionError) as e:
    print(f"   SUCCESS: New directory creation correctly failed: {type(e).__name__}")
except Exception as e:
    print(f"   UNEXPECTED ERROR: {e}")

# Test file deletion (should fail)
print(f"\n5. Testing file deletion (should fail):")
try:
    if os.path.exists(mount_dir) and os.listdir(mount_dir):
        test_file = os.path.join(mount_dir, os.listdir(mount_dir)[0])
        os.remove(test_file)
        print("   ERROR: File deletion should have failed!")
except (OSError, PermissionError) as e:
    print(f"   SUCCESS: File deletion correctly failed: {type(e).__name__}")
except Exception as e:
    print(f"   UNEXPECTED ERROR: {e}")

# Test /outputs directory (should work)
print(f"\n6. Testing /outputs directory (should work):")
try:
    os.makedirs("/outputs/test", exist_ok=True)
    with open("/outputs/test/output_file.txt", 'w') as f:
        f.write("This should work in outputs directory")
    print("   SUCCESS: Can create files in /outputs directory")
    
    # List what we created
    if os.path.exists("/outputs"):
        for root, dirs, files in os.walk("/outputs"):
            for file in files:
                print(f"   Created: {os.path.join(root, file)}")
except Exception as e:
    print(f"   ERROR: Failed to write to /outputs: {e}")

print(f"\n=== Read-Only Mount Test Complete ===")
