package main

import (
	"bytes"
	"encoding/binary"
)

// OGG CRC32 lookup table (polynomial 0x04C11DB7, non-reflected, as per OGG spec)
var oggCRCTable [256]uint32

func init() {
	for i := 0; i < 256; i++ {
		r := uint32(i) << 24
		for j := 0; j < 8; j++ {
			if r&0x80000000 != 0 {
				r = (r << 1) ^ 0x04C11DB7
			} else {
				r <<= 1
			}
		}
		oggCRCTable[i] = r
	}
}

func oggCRC32(data []byte) uint32 {
	var crc uint32
	for _, b := range data {
		crc = (crc << 8) ^ oggCRCTable[((crc>>24)&0xFF)^uint32(b)]
	}
	return crc
}

// buildSegmentTable creates the OGG segment table for a packet of given length
func buildSegmentTable(dataLen int) []byte {
	if dataLen == 0 {
		return []byte{0}
	}
	var segments []byte
	remaining := dataLen
	for remaining >= 255 {
		segments = append(segments, 255)
		remaining -= 255
	}
	segments = append(segments, byte(remaining))
	return segments
}

// writeOGGPage writes a single OGG page to the buffer
func writeOGGPage(w *bytes.Buffer, serialNo uint32, pageSeqNo uint32, granulePos int64, headerType byte, data []byte) {
	segTable := buildSegmentTable(len(data))

	// Build page with CRC placeholder (0)
	page := &bytes.Buffer{}
	page.WriteString("OggS")                                        // capture pattern
	page.WriteByte(0)                                                // stream structure version
	page.WriteByte(headerType)                                       // header type flag
	binary.Write(page, binary.LittleEndian, granulePos)              // granule position
	binary.Write(page, binary.LittleEndian, serialNo)                // serial number
	binary.Write(page, binary.LittleEndian, pageSeqNo)               // page sequence number
	binary.Write(page, binary.LittleEndian, uint32(0))               // CRC placeholder
	page.WriteByte(byte(len(segTable)))                              // number of segments
	page.Write(segTable)                                             // segment table
	page.Write(data)                                                 // page data

	// Compute CRC and patch it into bytes 22-25
	pageBytes := page.Bytes()
	crc := oggCRC32(pageBytes)
	pageBytes[22] = byte(crc)
	pageBytes[23] = byte(crc >> 8)
	pageBytes[24] = byte(crc >> 16)
	pageBytes[25] = byte(crc >> 24)

	w.Write(pageBytes)
}

// createOpusHead builds the OpusHead identification header
func createOpusHead(sampleRate uint32) []byte {
	buf := &bytes.Buffer{}
	buf.WriteString("OpusHead")                              // magic
	buf.WriteByte(1)                                         // version
	buf.WriteByte(1)                                         // channel count (mono)
	binary.Write(buf, binary.LittleEndian, uint16(312))      // pre-skip samples
	binary.Write(buf, binary.LittleEndian, sampleRate)       // input sample rate
	binary.Write(buf, binary.LittleEndian, int16(0))         // output gain
	buf.WriteByte(0)                                         // channel mapping family
	return buf.Bytes()
}

// createOpusTags builds the OpusTags comment header
func createOpusTags() []byte {
	buf := &bytes.Buffer{}
	buf.WriteString("OpusTags")                              // magic
	vendor := "cs2-demo-viewer"
	binary.Write(buf, binary.LittleEndian, uint32(len(vendor)))
	buf.WriteString(vendor)
	binary.Write(buf, binary.LittleEndian, uint32(0))        // no user comments
	return buf.Bytes()
}

// BuildOggOpus creates an OGG/Opus file from raw Opus frames.
// Returns a complete .ogg file as bytes that is playable by any modern media player.
func BuildOggOpus(frames [][]byte, sampleRate uint32) []byte {
	if len(frames) == 0 {
		return nil
	}

	buf := &bytes.Buffer{}
	serialNo := uint32(1)
	pageSeq := uint32(0)

	// Page 1: OpusHead (beginning of stream)
	writeOGGPage(buf, serialNo, pageSeq, 0, 0x02, createOpusHead(sampleRate))
	pageSeq++

	// Page 2: OpusTags
	writeOGGPage(buf, serialNo, pageSeq, 0, 0x00, createOpusTags())
	pageSeq++

	// Audio pages — one Opus frame per page
	// Typical Opus frame at 48kHz = 960 samples (20ms)
	samplesPerFrame := int64(960)
	granulePos := int64(312) // start after pre-skip

	for i, frame := range frames {
		granulePos += samplesPerFrame
		headerType := byte(0x00)
		if i == len(frames)-1 {
			headerType = 0x04 // end of stream
		}
		writeOGGPage(buf, serialNo, pageSeq, granulePos, headerType, frame)
		pageSeq++
	}

	return buf.Bytes()
}
