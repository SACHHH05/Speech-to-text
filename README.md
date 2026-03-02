<h1 align="center">REAL TIME MICROPHONE SPEECH TO TEXT MODULE</h1>

<hr>

<h2>Overview</h2>

<p>
This project is a reusable speech-to-text module that enables users to convert live microphone input into text in real time.
</p>

<p>
It provides a complete end-to-end pipeline, from browser-based audio capture to backend AI transcription using a GPU-accelerated Whisper model. The module can be integrated into applications that require live voice input, such as AI assistants, interview systems, voice search platforms, and productivity tools.
</p>

<hr>

<h2>Architecture Overview</h2>

<p>
The module follows a client–server architecture designed for low-latency streaming and efficient AI inference.
</p>

<h3>Frontend Angular 17</h3>
<ul>
  <li>Captures microphone audio</li>
  <li>Detects speech activity using RMS-based logic</li>
  <li>Streams audio chunks via WebSocket</li>
  <li>Renders live transcription with a typewriter-style UI</li>
</ul>

<h3>Backend Python</h3>
<ul>
  <li>Receives WebM/Opus audio streams</li>
  <li>Decodes audio using PyAV</li>
  <li>Converts audio to 16kHz mono waveform</li>
  <li>Performs speech-to-text transcription using Faster-Whisper</li>
</ul>

<h3>AI Layer GPU Accelerated</h3>
<ul>
  <li>Uses NVIDIA RTX 3060 (if available)</li>
  <li>Automatic CUDA detection</li>
  <li>Optimized inference for streaming transcription</li>
</ul>

<hr>

<h2>Key Features</h2>

<ul>
  <li>Real time microphone streaming</li>
  <li>Low latency WebSocket communication</li>
  <li>GPU accelerated speech recognition</li>
  <li>Silence detection for performance optimization</li>
  <li>Partial streaming responses with accurate final transcript</li>
  <li>Clean animated UI rendering</li>
  <li>Controlled recording sessions (60-second limit)</li>
  <li>Automatic WebSocket reconnection</li>
</ul>

<hr>

<h2>Purpose</h2>

<p>
This module is designed to be integrated into applications that require reliable, real-time voice-to-text conversion with high accuracy and low latency.
</p>

<p>
It demonstrates practical implementation of streaming architecture, audio decoding, GPU-based AI inference, and full-stack integration in a production-style environment.
</p>
