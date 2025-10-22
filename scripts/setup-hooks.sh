#!/bin/bash

# Setup script to install git hooks for the ldaptoid project

set -e

echo "Setting up git hooks for ldaptoid..."

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "Error: This script must be run from the root of the git repository"
    exit 1
fi

# Check if deno is available
if ! command -v deno &> /dev/null; then
    echo "Warning: deno is not installed or not in PATH"
    echo "Please install deno before using the pre-commit hook"
fi

# Create the pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash

# Pre-commit hook to run deno fmt on staged TypeScript files

# Check if deno is available
if ! command -v deno &> /dev/null; then
    echo "Error: deno is not installed or not in PATH"
    exit 1
fi

# Get list of staged TypeScript files
staged_files=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|js|json)$')

if [ -z "$staged_files" ]; then
    # No TypeScript/JavaScript/JSON files staged, exit successfully
    exit 0
fi

echo "Running deno fmt on staged files..."

# Run deno fmt on staged files
echo "$staged_files" | xargs deno fmt

# Check if deno fmt made any changes
if [ $? -ne 0 ]; then
    echo "Error: deno fmt failed"
    exit 1
fi

# Add the formatted files back to staging area
echo "$staged_files" | xargs git add

echo "Code formatting completed successfully!"
exit 0
EOF

# Make the hook executable
chmod +x .git/hooks/pre-commit

echo "✅ Pre-commit hook installed successfully!"
echo "The hook will automatically run 'deno fmt' on staged TypeScript/JavaScript/JSON files before each commit."
echo ""
echo "To skip the hook for a specific commit, use: git commit --no-verify"
echo "To test the hook, stage some files and run: .git/hooks/pre-commit"