NAME := file-explorer-tools
VERSION := $(shell node -p "require('./package.json').version")
VSIX := $(NAME)-$(VERSION).vsix

.PHONY: install build watch lint pack clean install-ext

install:
	npm install

build: install
	npm run build

watch: install
	npm run watch

lint: install
	npm run lint

pack: build
	npx @vscode/vsce package --no-dependencies -o $(VSIX)
	@echo "Packaged: $(VSIX)"

install-ext: pack
	code --install-extension $(VSIX)

clean:
	rm -rf dist node_modules *.vsix
