import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface GameLogPayload {
  instanceId: string;
  stream: "stdout" | "stderr";
  line: string;
}

export function useGameLogs() {
  const [isOpen, setIsOpen] = useState(false);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState("");
  const [stdoutText, setStdoutText] = useState("");
  const [stderrText, setStderrText] = useState("");

  useEffect(() => {
    let unlisten: null | (() => void) = null;
    listen<GameLogPayload>("game_log", (event) => {
      const payload = event.payload;
      if (!payload) return;
      if (!instanceId || payload.instanceId !== instanceId) return;
      if (payload.stream === "stdout") {
        setStdoutText((prev) => {
          const next = prev ? `${prev}\n${payload.line}` : payload.line;
          if (next.length > 600_000) return next.slice(-450_000);
          return next;
        });
      } else {
        setStderrText((prev) => {
          const next = prev ? `${prev}\n${payload.line}` : payload.line;
          if (next.length > 300_000) return next.slice(-220_000);
          return next;
        });
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) {
        try { (unlisten as any)(); } catch {}
      }
    };
  }, [instanceId]);

  async function preload(instanceIdValue: string, maxLines: number) {
    try {
      const [out, err] = await Promise.all([
        invoke<string>("get_instance_log_tail", { instanceId: instanceIdValue, kind: "stdout", maxLines: maxLines }),
        invoke<string>("get_instance_log_tail", { instanceId: instanceIdValue, kind: "stderr", maxLines: maxLines }),
      ]);
      setStdoutText(out || "");
      setStderrText(err || "");
    } catch {
      setStdoutText("");
      setStderrText("");
    }
  }

  function open(instance: { id: string; name: string }, maxLines = 200) {
    setIsOpen(true);
    setInstanceId(instance.id);
    setInstanceName(instance.name);
    setStdoutText("");
    setStderrText("");
    preload(instance.id, maxLines);
  }

  function close() {
    setIsOpen(false);
    setInstanceId(null);
    setInstanceName("");
  }

  function clear() {
    setStdoutText("");
    setStderrText("");
  }

  async function clearAndTruncateFiles() {
    if (!instanceId) {
      clear();
      return;
    }
    clear();
    try {
      await invoke("clear_instance_logs", { instanceId: instanceId });
    } catch {}
  }

  return {
    isOpen,
    instanceId,
    instanceName,
    stdoutText,
    stderrText,
    open,
    close,
    clear,
    clearAndTruncateFiles,
    preload,
  };
}
