//go:build js && wasm

package main

import (
	"bytes"
	"syscall/js"
)

func main() {
	js.Global().Set("parseDemoWasm", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) == 0 {
			return map[string]any{"error": "missing demo bytes"}
		}

		demoBytes := make([]byte, args[0].Length())
		js.CopyBytesToGo(demoBytes, args[0])

		jsonData, err := ParseDemo(bytes.NewReader(demoBytes))
		if err != nil {
			return map[string]any{"error": err.Error()}
		}

		return string(jsonData)
	}))

	select {}
}
