//go:build js && wasm

package main

import (
	"bytes"
	"strconv"
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

	// extractVoiceOgg(steamId: number, startTick: number, endTick: number) → Uint8Array | {error: string}
	// Extracts voice data for a player within a tick range and returns an OGG/Opus file.
	// Pass startTick=0 and endTick=0 to extract all voice data for the player.
	js.Global().Set("extractVoiceOgg", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) < 3 {
			return map[string]any{"error": "usage: extractVoiceOgg(steamId, startTick, endTick)"}
		}

		steamID, err := strconv.ParseUint(args[0].String(), 10, 64)
		if err != nil {
			return map[string]any{"error": "invalid steam ID"}
		}
		startTick := int(args[1].Float())
		endTick := int(args[2].Float())

		segments, ok := StoredVoiceData[steamID]
		if !ok || len(segments) == 0 {
			return map[string]any{"error": "no voice data for this player"}
		}

		// Collect frames, skipping DTX/silence packets (tiny Opus frames ≤ 2 bytes
		// that decode to silence/comfort noise) so the export is compact with no gaps.
		var frames [][]byte

		for _, seg := range segments {
			if startTick > 0 && seg.Tick < startTick {
				continue
			}
			if endTick > 0 && seg.Tick > endTick {
				continue
			}

			if StoredVoiceFormat == "opus" {
				if len(seg.Data) > 2 {
					frames = append(frames, seg.Data)
				}
			} else if StoredVoiceFormat == "steam" {
				opusFrames := extractOpusFromSteamChunk(seg.Data)
				for _, frame := range opusFrames {
					if len(frame) > 2 {
						frames = append(frames, frame)
					}
				}
			}
		}

		oggData := BuildOggOpus(frames, StoredVoiceSampleRate)
		if oggData == nil {
			return map[string]any{"error": "failed to build OGG file"}
		}

		// Return as Uint8Array
		jsArray := js.Global().Get("Uint8Array").New(len(oggData))
		js.CopyBytesToJS(jsArray, oggData)
		return jsArray
	}))

	select {}
}

// extractOpusFromSteamChunk parses Steam Voice chunk format to extract raw Opus frame data.
// Steam Voice chunk structure: SteamID(8) + PayloadType(1) + SampleRate(2) + VoiceType(1) + Length(2) + Data(Length) + CRC32(4)
func extractOpusFromSteamChunk(data []byte) [][]byte {
	if len(data) < 18 {
		return nil
	}

	buf := bytes.NewReader(data)

	// Skip SteamID (8 bytes)
	buf.Seek(8, 0)

	// Read payload type
	var payloadType byte
	if err := readByte(buf, &payloadType); err != nil || payloadType != 0x0B {
		return nil
	}

	// Skip sample rate (2 bytes)
	buf.Seek(2, 1)

	// Read voice type
	var voiceType byte
	if err := readByte(buf, &voiceType); err != nil {
		return nil
	}

	// Read data length
	var dataLen uint16
	if err := readUint16(buf, &dataLen); err != nil {
		return nil
	}

	if voiceType == 0x06 && dataLen > 0 {
		// Contains Opus audio data — parse the inner chunk format
		innerData := make([]byte, dataLen)
		n, _ := buf.Read(innerData)
		if n < int(dataLen) {
			return nil
		}

		// The inner data for Steam format contains: [chunkLen:int16][frameNum:uint16][opusData:chunkLen bytes]...
		var frames [][]byte
		innerBuf := bytes.NewReader(innerData)
		for innerBuf.Len() > 0 {
			var chunkLen int16
			if err := readInt16(innerBuf, &chunkLen); err != nil {
				break
			}
			if chunkLen == -1 {
				break // end marker
			}
			// Skip frame number (2 bytes)
			innerBuf.Seek(2, 1)

			if chunkLen > 0 {
				frame := make([]byte, chunkLen)
				n, err := innerBuf.Read(frame)
				if err != nil || n < int(chunkLen) {
					break
				}
				frames = append(frames, frame)
			}
		}
		return frames
	}

	return nil
}

func readByte(r *bytes.Reader, v *byte) error {
	b, err := r.ReadByte()
	if err != nil {
		return err
	}
	*v = b
	return nil
}

func readUint16(r *bytes.Reader, v *uint16) error {
	var buf [2]byte
	_, err := r.Read(buf[:])
	if err != nil {
		return err
	}
	*v = uint16(buf[0]) | uint16(buf[1])<<8
	return nil
}

func readInt16(r *bytes.Reader, v *int16) error {
	var buf [2]byte
	_, err := r.Read(buf[:])
	if err != nil {
		return err
	}
	*v = int16(uint16(buf[0]) | uint16(buf[1])<<8)
	return nil
}
