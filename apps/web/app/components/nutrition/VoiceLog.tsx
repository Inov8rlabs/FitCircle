'use client';

import { Loader2, Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { nutritionClient, ApiError, type NutritionDraft } from '@/lib/api/nutrition-client';

import { NutritionConfirm } from './NutritionConfirm';

// Minimal Web Speech API typings (not in lib.dom for all targets).
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

interface VoiceLogProps {
  onLogged?: () => void;
}

/**
 * Voice → nutrition. Uses the Web Speech API for STT, posts the transcript to
 * /food/voice-parse, then shows the draft in NutritionConfirm. Feature-detected:
 * renders nothing when the browser has no SpeechRecognition.
 */
export function VoiceLog({ onLogged }: VoiceLogProps) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<NutritionDraft | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() != null);
    return () => recRef.current?.stop();
  }, []);

  const parse = async (text: string) => {
    const t = text.trim().slice(0, 1000);
    if (!t) return;
    setParsing(true);
    setError(null);
    try {
      const result = await nutritionClient.voiceParse(t);
      setDraft(result);
      setShowConfirm(true);
    } catch (err) {
      // Option B: parse failed/rate-limited, but the server saved the transcript as a
      // food-log entry so it's not lost. Show the friendly note and refresh so it appears.
      if (err instanceof ApiError && err.details?.savedEntryId) {
        setError(err.message);
        onLogged?.();
      } else {
        setError(err instanceof Error ? err.message : 'Could not parse that. Try again or use search.');
      }
    } finally {
      setParsing(false);
    }
  };

  const start = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }
      setTranscript((finalText + interim).trim());
    };
    rec.onerror = (e: any) => {
      setError(e?.error === 'not-allowed' ? 'Microphone permission denied.' : 'Voice input error.');
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      if (finalText.trim()) void parse(finalText);
    };
    recRef.current = rec;
    setTranscript('');
    setError(null);
    setListening(true);
    rec.start();
  };

  const stop = () => recRef.current?.stop();

  const reset = () => {
    setShowConfirm(false);
    setDraft(null);
    setTranscript('');
  };

  if (!supported) return null;

  if (showConfirm) {
    return (
      <NutritionConfirm
        draft={draft}
        onCommitted={() => {
          reset();
          onLogged?.();
        }}
        onCancel={reset}
      />
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={listening ? stop : start}
        disabled={parsing}
        aria-pressed={listening}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/60 px-4 py-3 text-sm font-medium text-gray-200 hover:bg-slate-700/60 disabled:opacity-50"
      >
        {parsing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Parsing…
          </>
        ) : listening ? (
          <>
            <Square className="h-4 w-4 text-red-400" aria-hidden="true" /> Stop &amp; log
          </>
        ) : (
          <>
            <Mic className="h-4 w-4" aria-hidden="true" /> Log by voice
          </>
        )}
      </button>
      {(listening || transcript) && !parsing && (
        <p className="mt-2 text-sm text-gray-400" aria-live="polite">
          {transcript || 'Listening… describe what you ate.'}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-amber-300">{error}</p>}
    </div>
  );
}
