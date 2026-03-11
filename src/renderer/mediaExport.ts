import { registerAacEncoder } from "@mediabunny/aac-encoder";
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_LOW,
} from "mediabunny";

let aacEncoderRegistered = false;

const ensureAacEncoder = () => {
  if (aacEncoderRegistered) {
    return;
  }

  registerAacEncoder();
  aacEncoderRegistered = true;
};

const drawSlate = (
  canvas: HTMLCanvasElement,
  title: string,
  subtitle: string,
) => {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to initialize MP4 video canvas");
  }

  context.fillStyle = "#06080b";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "#2d3748";
  context.lineWidth = 2;
  context.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);

  context.fillStyle = "#d7e0ea";
  context.textAlign = "center";
  context.font = "700 28px Segoe UI, sans-serif";
  context.fillText(title, canvas.width / 2, canvas.height / 2 - 12);

  context.fillStyle = "#94a3b8";
  context.font = "500 16px Segoe UI, sans-serif";
  context.fillText(subtitle, canvas.width / 2, canvas.height / 2 + 22);
};

export const exportVoiceOggToMp4 = async (
  oggData: Uint8Array,
  title: string,
  subtitle: string,
): Promise<Uint8Array> => {
  ensureAacEncoder();

  const oggBlob = new Blob([new Uint8Array(oggData)], { type: "audio/ogg" });
  const input = new Input({
    source: new BlobSource(oggBlob),
    formats: ALL_FORMATS,
  });

  const audioTrack = await input.getPrimaryAudioTrack();
  if (!audioTrack) {
    throw new Error("The extracted voice clip does not contain an audio track");
  }

  const sink = new AudioBufferSink(audioTrack);
  const duration = await input.computeDuration();
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Unable to determine voice clip duration for MP4 export");
  }

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  drawSlate(canvas, title, subtitle);

  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: 150_000,
  });
  const audioSource = new AudioBufferSource({
    codec: "aac",
    bitrate: 96_000,
  });

  output.addVideoTrack(videoSource, { frameRate: 1, name: "Voice Slate" });
  output.addAudioTrack(audioSource, { name: "Voice Chat" });

  await output.start();

  let currentTime = 0;
  while (currentTime < duration) {
    const frameDuration = Math.min(1, duration - currentTime);
    await videoSource.add(currentTime, frameDuration, {
      keyFrame: currentTime === 0,
    });
    currentTime += frameDuration;
  }
  videoSource.close();

  for await (const { buffer } of sink.buffers()) {
    await audioSource.add(buffer);
  }
  audioSource.close();

  await output.finalize();

  const mp4Buffer = output.target.buffer;
  if (!mp4Buffer) {
    throw new Error("MP4 export did not produce any output");
  }

  return new Uint8Array(mp4Buffer);
};