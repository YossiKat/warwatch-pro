import { useState, useCallback, useRef, useEffect } from 'react';

export interface VoiceCommand {
  pattern: RegExp;
  action: () => void;
  description: string;
}

interface UseVoiceControlOptions {
  lang: string; // e.g. 'he-IL', 'en-US'
  commands: VoiceCommand[];
  onTranscript?: (text: string) => void;
  continuous?: boolean;
}

export function useVoiceControl({ lang, commands, onTranscript, continuous = false }: UseVoiceControlOptions) {
  const [isListening, setIsListening] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event: any) => {
      const results = event.results;
      for (let i = event.resultIndex; i < results.length; i++) {
        if (!results[i].isFinal) continue;
        const transcript = results[i][0].transcript.trim().toLowerCase();
        setLastTranscript(transcript);
        onTranscript?.(transcript);

        // Match commands
        for (const cmd of commands) {
          if (cmd.pattern.test(transcript)) {
            cmd.action();
            break;
          }
        }
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      if (continuous && recognitionRef.current) {
        try { recognition.start(); setIsListening(true); } catch {}
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('Speech recognition error:', e.error);
      }
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try { recognition.stop(); } catch {}
      recognitionRef.current = null;
    };
  }, [lang, continuous]);

  // Update commands ref without recreating recognition
  const commandsRef = useRef(commands);
  useEffect(() => { commandsRef.current = commands; }, [commands]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListening) return;
    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch {}
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
      setIsListening(false);
    } catch {}
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  return { isListening, lastTranscript, supported, startListening, stopListening, toggleListening };
}
