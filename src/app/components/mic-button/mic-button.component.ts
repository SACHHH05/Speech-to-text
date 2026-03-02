import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { VoiceRecorderService, RecordingStatus } from '../../services/voice-recorder.service';
import { WebsocketService, WsStatus } from '../../services/websocket.service';

const MAX_SECONDS   = 60;
const CIRCUMFERENCE = 2 * Math.PI * 50;
const POPUP_CIRC    = 2 * Math.PI * 18;
const POPUP_SEC     = 3;

@Component({
  selector: 'app-mic-button',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mic-button.component.html',
  styleUrls: ['./mic-button.component.scss']
})
export class MicButtonComponent implements OnInit, OnDestroy {

  recStatus: RecordingStatus = {
    state: 'idle', secondsLeft: MAX_SECONDS,
    volumeLevel: 0, showNoSpeechPopup: false, popupCountdown: 3
  };
  wsStatus: WsStatus   = 'disconnected';
  streamingText        = '';
  finalText            = '';
  displayedWords: string[] = [];   // words shown so far (typewriter)
  copyLabel            = 'copy';
  bars                 = [0,1,2,3,4,5,6,7];

  private subs         = new Subscription();
  private typewriterTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public recorder: VoiceRecorderService,
    public ws: WebsocketService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.ws.connect();

    this.subs.add(this.ws.status$.subscribe(s => { this.wsStatus = s; }));

    // Stream each chunk to backend
    this.subs.add(this.recorder.chunkReady$.subscribe(({ blob, isFinal }) => {
      this.ws.sendChunk(blob, isFinal);
    }));

    // Handle messages from backend
    this.subs.add(this.ws.message$.subscribe(msg => {
      if (msg.type === 'partial' && msg.text) {
        this.streamingText = msg.text;
        this._typewriterUpdate(msg.text);
      } else if (msg.type === 'transcript') {
        this.finalText     = msg.text || '';
        this.streamingText = '';
        if (this.finalText) {
          this._typewriterUpdate(this.finalText);
        }
      }
      this.cdr.detectChanges();
    }));

    this.subs.add(this.recorder.status$.subscribe(s => {
      this.recStatus = s;
      this.cdr.detectChanges();
    }));
  }

  async onMicClick(): Promise<void> {
    if (!this.ws.isConnected) return;

    if (this.recorder.isRecording) {
      this.recorder.stop('manual');
    } else {
      // Reset everything on new session
      this.streamingText   = '';
      this.finalText       = '';
      this.displayedWords  = [];
      this.ws.reset();
      try { await this.recorder.start(); }
      catch { console.error('Mic access denied'); }
    }
  }

  // Typewriter: smoothly add new words as they come in
  private _typewriterUpdate(newText: string): void {
    const newWords     = newText.trim().split(/\s+/);
    const currentWords = this.displayedWords;

    // Find how many words already match
    let matchCount = 0;
    for (let i = 0; i < Math.min(currentWords.length, newWords.length); i++) {
      if (currentWords[i] === newWords[i]) matchCount++;
      else break;
    }

    // Words to add
    const toAdd = newWords.slice(matchCount);
    if (toAdd.length === 0) return;

    // Reset to matched prefix
    this.displayedWords = newWords.slice(0, matchCount);

    // Add new words one by one with small delay
    let i = 0;
    const addNext = () => {
      if (i >= toAdd.length) return;
      this.displayedWords = [...this.displayedWords, toAdd[i]];
      this.cdr.detectChanges();
      i++;
      this.typewriterTimer = setTimeout(addNext, 40); // 40ms per word
    };
    addNext();
  }

  copyTranscript(): void {
    navigator.clipboard.writeText(this.finalText || this.streamingText);
    this.copyLabel = 'copied!';
    setTimeout(() => this.copyLabel = 'copy', 1500);
  }

  get isRecording()  { return this.recStatus.state === 'recording'; }
  get isProcessing() { return this.recStatus.state === 'processing'; }
  get hasContent()   { return this.displayedWords.length > 0; }
  get isStreaming()  { return this.isRecording && !!this.streamingText; }

  get ringOffset(): number {
    return CIRCUMFERENCE * (1 - this.recStatus.secondsLeft / MAX_SECONDS);
  }
  get ringColor(): string {
    const s = this.recStatus.secondsLeft;
    return s <= 10 ? '#ef4444' : s <= 20 ? '#f97316' : 'white';
  }
  get popupRingOffset(): number {
    return POPUP_CIRC * (1 - this.recStatus.popupCountdown / POPUP_SEC);
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.typewriterTimer) clearTimeout(this.typewriterTimer);
  }
}
