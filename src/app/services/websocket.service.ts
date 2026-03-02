import { Injectable, OnDestroy } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface WsMessage {
  type: 'partial' | 'transcript' | 'error';
  text?: string;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class WebsocketService implements OnDestroy {

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sendQueue: Array<() => void> = [];

  readonly status$ = new BehaviorSubject<WsStatus>('disconnected');
  readonly message$ = new Subject<WsMessage>();

  connect(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.status$.next('connecting');
    this.ws = new WebSocket(environment.wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.status$.next('connected');
      // Flush any queued sends
      this.sendQueue.forEach(fn => fn());
      this.sendQueue = [];
    };
    this.ws.onclose = () => {
      this.status$.next('disconnected');
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };
    this.ws.onerror = () => this.status$.next('error');
    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: WsMessage = JSON.parse(event.data as string);
        this.message$.next(msg);
      } catch {
        console.error('Failed to parse WS message', event.data);
      }
    };
  }

  sendChunk(blob: Blob, isFinal: boolean): void {
    if (!this.isConnected) {
      console.warn('WS not connected, dropping chunk');
      return;
    }
    const type = isFinal ? 'audio_final' : 'audio_chunk';
    blob.arrayBuffer().then(buffer => {
      if (!this.isConnected) return;
      try {
        this.ws!.send(JSON.stringify({ type, size: buffer.byteLength }));
        this.ws!.send(buffer);
      } catch (e) {
        console.error('Send error:', e);
      }
    });
  }

  reset(): void {
    if (this.isConnected) {
      this.ws!.send(JSON.stringify({ type: 'reset' }));
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  ngOnDestroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
