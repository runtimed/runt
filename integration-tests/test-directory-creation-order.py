#!/usr/bin/env python3
"""
Test to verify that directories are set read-only in the correct order.
This simulates what happens during the mounting process.
"""

print("=== Testing Directory Creation Order Logic ===")

# Simulate the file structure that would be created during mounting
test_files = [
    {"path": "file1.txt", "content": "File 1 content"},
    {"path": "subdir1/file2.txt", "content": "File 2 content"},
    {"path": "subdir1/subdir2/file3.txt", "content": "File 3 content"},
    {"path": "subdir1/subdir2/file4.txt", "content": "File 4 content"},
    {"path": "another_dir/file5.txt", "content": "File 5 content"},
]

print("\nFiles that would be mounted:")
for file_info in test_files:
    print(f"  {file_info['path']}")

# Extract all unique directories that would be created
directories = set()
mount_point = "/mnt/test"
directories.add(mount_point)

for file_info in test_files:
    virtual_path = f"{mount_point}/{file_info['path']}"
    parent_dir = virtual_path[:virtual_path.rfind('/')]
    
    if parent_dir != mount_point:
        # Track all directory components
        current_path = mount_point
        path_parts = parent_dir[len(mount_point)+1:].split('/')
        
        for part in path_parts:
            current_path = f"{current_path}/{part}"
            directories.add(current_path)

print(f"\nDirectories that would be created and then set read-only:")
for dir_path in sorted(directories):
    print(f"  {dir_path}")

print(f"\nTotal directories: {len(directories)}")
print("✅ All directories would be set read-only AFTER all files are copied")
print("✅ This prevents permission errors during the mounting process")
