//go:build !js

package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	filePath := flag.String("input", "", "Path to the .dem file")
	outputPath := flag.String("output", "", "Path to the output .json file (optional)")
	flag.Parse()

	if *filePath == "" {
		fmt.Println("Error: Please provide a file path using -input")
		return
	}

	f, err := os.Open(*filePath)
	if err != nil {
		panic(err)
	}
	defer f.Close()

	jsonData, err := ParseDemo(f)
	if err != nil {
		panic(err)
	}

	if *outputPath != "" {
		err = os.WriteFile(*outputPath, jsonData, 0644)
		if err != nil {
			panic(err)
		}
		fmt.Printf("Successfully wrote data to %s\n", *outputPath)
	} else {
		fmt.Println(string(jsonData))
	}
}
