import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

export type RecordingState = 'idle' | 'recording' | 'processing';
export type StopReason = 'manual' | 'timeout' | 'no-speech';

export interface RecordingStatus {
  state: RecordingState;
  secondsLeft: number;
  volumeLevel: number;
  showNoSpeechPopup: boolean;
  popupCountdown: number;
}

const MAX_SECONDS = 60;
const SILENCE_THRESHOLD = 0.008;   // RMS threshold for speech detection
const POPUP_COUNTDOWN = 3;
const CHUNK_MS = 1500;    // send chunk every 1.5s

@Injectable({ providedIn: 'root' })
export class VoiceRecorderService implements OnDestroy {

  readonly status$ = new BehaviorSubject<RecordingStatus>({
    state: 'idle', secondsLeft: MAX_SECONDS,
    volumeLevel: 0, showNoSpeechPopup: false, popupCountdown: POPUP_COUNTDOWN,
  });

  readonly chunkReady$ = new Subject<{ blob: Blob; isFinal: boolean }>();

  private mediaRecorder: MediaRecorder | null = null;
  private allChunks: Blob[] = [];  // ALL chunks since recording started
  private windowChunks: Blob[] = [];  // chunks in current send window
  private mimeType = 'audio/webm;codecs=opus';
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId = 0;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;
  private chunkInterval: ReturnType<typeof setInterval> | null = null;
  private popupInterval: ReturnType<typeof setInterval> | null = null;
  private secondsLeft = MAX_SECONDS;
  private userSpoke = false;
  private stopping = false;
  private hasSpeechInWindow = false;  // track if current window has speech

  get isRecording(): boolean {
    return this.status$.value.state === 'recording';
  }

  async start(): Promise<void> {
    this.stopping = false;
    this.userSpoke = false;
    this.hasSpeechInWindow = false;
    this.allChunks = [];
    this.windowChunks = [];
    this.secondsLeft = MAX_SECONDS;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleSize: 16,
      }
    });

    this.mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';

    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: this.mimeType,
      audioBitsPerSecond: 128000,
    });

    this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) {
        this.allChunks.push(e.data);
        this.windowChunks.push(e.data);
      }
    };

    // Final blob = everything recorded
    this.mediaRecorder.onstop = () => {
      if (this.userSpoke && this.allChunks.length > 0) {
        const blob = new Blob(this.allChunks, { type: this.mimeType });
        this.chunkReady$.next({ blob, isFinal: true });
      }
      this.allChunks = [];
      this.windowChunks = [];
    };

    this.mediaRecorder.start(100);  // get data every 100ms

    // Web Audio
    this.audioCtx = new AudioContext({ sampleRate: 16000 });
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.audioCtx.createMediaStreamSource(stream).connect(this.analyser);

    this._patch({
      state: 'recording', secondsLeft: this.secondsLeft,
      showNoSpeechPopup: false, popupCountdown: POPUP_COUNTDOWN
    });

    this._startCountdown();
    this._startChunkSender();
    this._startVolumeMonitor();
  }

  stop(reason: StopReason = 'manual'): void {
    if (!this.isRecording || this.stopping) return;
    this.stopping = true;
    this._clearTimers();

    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.requestData();
      this.mediaRecorder.stop();
    }
    this.mediaRecorder?.stream.getTracks().forEach(t => t.stop());
    this.audioCtx?.close();
    this.audioCtx = null;
    this._patch({ state: 'processing', showNoSpeechPopup: false });
  }

  dismissPopup(): void {
    this._clearPopupTimer();
    this._patch({ showNoSpeechPopup: false, state: 'idle', secondsLeft: MAX_SECONDS, volumeLevel: 0 });
  }

  // ── Private ────────────────────────────────────────────

  private _startChunkSender(): void {
    this.chunkInterval = setInterval(() => {
      // Only send if speech was detected in this window and we have data
      if (!this.userSpoke || this.windowChunks.length === 0) {
        this.windowChunks = [];
        this.hasSpeechInWindow = false;
        return;
      }

      // Snapshot window chunks → send cumulative audio for better accuracy
      // Send ALL audio so far (not just the window) so backend builds full context
      const snapshot = [...this.allChunks];
      this.windowChunks = [];  // reset window
      this.hasSpeechInWindow = false;

      if (snapshot.length === 0) return;

      const blob = new Blob(snapshot, { type: this.mimeType });
      this.chunkReady$.next({ blob, isFinal: false });

    }, CHUNK_MS);
  }

  private _startCountdown(): void {
    this.countdownInterval = setInterval(() => {
      this.secondsLeft--;
      this._patch({ secondsLeft: this.secondsLeft });
      if (this.secondsLeft <= 0) {
        clearInterval(this.countdownInterval!);
        if (!this.userSpoke) {
          this._triggerNoSpeechPopup();
        } else {
          this.stop('timeout');
        }
      }
    }, 1000);
  }

  private _startVolumeMonitor(): void {
    const data = new Uint8Array(this.analyser!.fftSize);
    const tick = () => {
      if (!this.isRecording) return;
      this.analyser!.getByteTimeDomainData(data);

      // RMS calculation
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);

      if (rms >= SILENCE_THRESHOLD) {
        this.userSpoke = true;
        this.hasSpeechInWindow = true;
      }

      this._patch({ volumeLevel: rms });
      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private _triggerNoSpeechPopup(): void {
    this._clearTimers();
    this.mediaRecorder?.stop();
    this.mediaRecorder?.stream.getTracks().forEach(t => t.stop());
    this.audioCtx?.close();
    this.audioCtx = null;
    let popupCountdown = POPUP_COUNTDOWN;
    this._patch({ showNoSpeechPopup: true, popupCountdown, state: 'idle' });
    this.popupInterval = setInterval(() => {
      popupCountdown--;
      this._patch({ popupCountdown });
      if (popupCountdown <= 0) this.dismissPopup();
    }, 1000);
  }

  private _patch(partial: Partial<RecordingStatus>): void {
    this.status$.next({ ...this.status$.value, ...partial });
  }

  private _clearTimers(): void {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    if (this.chunkInterval) clearInterval(this.chunkInterval);
    cancelAnimationFrame(this.animFrameId);
  }

  private _clearPopupTimer(): void {
    if (this.popupInterval) clearInterval(this.popupInterval);
  }

  ngOnDestroy(): void {
    this._clearTimers();
    this._clearPopupTimer();
    this.audioCtx?.close();
  }
}