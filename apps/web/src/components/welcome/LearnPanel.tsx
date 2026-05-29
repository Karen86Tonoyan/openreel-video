import { useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Clock, CheckCircle2, ChevronRight } from "lucide-react";
import { Button } from "@openreel/ui";
import { claudeCourse, type CourseLesson } from "../../data/claudeCourse";

interface LearnPanelProps {
  onBack: () => void;
}

export const LearnPanel: React.FC<LearnPanelProps> = ({ onBack }) => {
  const [activeLesson, setActiveLesson] = useState<CourseLesson | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("claude-course-completed");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const markComplete = (id: string) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem("claude-course-completed", JSON.stringify([...next]));
      return next;
    });
  };

  if (activeLesson) {
    const idx = claudeCourse.findIndex((l) => l.id === activeLesson.id);
    const next = claudeCourse[idx + 1] ?? null;
    const prev = claudeCourse[idx - 1] ?? null;

    return (
      <div className="flex flex-col h-full">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={() => setActiveLesson(null)}>
            <ArrowLeft size={16} />
            Powrót do listy
          </Button>
          <span className="text-xs text-text-muted font-mono">
            {idx + 1} / {claudeCourse.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => markComplete(activeLesson.id)}
            className={completed.has(activeLesson.id) ? "text-primary" : "text-text-muted"}
          >
            <CheckCircle2 size={16} />
            {completed.has(activeLesson.id) ? "Ukończono" : "Oznacz ukończone"}
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto px-8 py-6 max-w-3xl mx-auto w-full">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono text-text-muted bg-background-tertiary px-2 py-0.5 rounded">
              Moduł {idx + 1}
            </span>
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <Clock size={11} />
              {activeLesson.duration}
            </span>
          </div>

          <h1 className="text-2xl font-bold text-text-primary mb-1">{activeLesson.title}</h1>
          <p className="text-text-secondary mb-8">{activeLesson.subtitle}</p>

          <div className="space-y-5">
            {activeLesson.sections.map((section, i) => {
              if (section.type === "heading") {
                return (
                  <h2 key={i} className="text-base font-semibold text-text-primary mt-6 first:mt-0 border-b border-border pb-2">
                    {section.content}
                  </h2>
                );
              }
              if (section.type === "paragraph") {
                return (
                  <p key={i} className="text-sm text-text-secondary leading-relaxed">
                    {section.content}
                  </p>
                );
              }
              if (section.type === "code") {
                return (
                  <pre key={i} className="bg-background-tertiary border border-border rounded-lg p-4 text-xs font-mono text-text-primary overflow-x-auto leading-relaxed whitespace-pre-wrap">
                    {section.content}
                  </pre>
                );
              }
              if (section.type === "list" && section.items) {
                return (
                  <ul key={i} className="space-y-2">
                    {section.content && (
                      <li className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">
                        {section.content}
                      </li>
                    )}
                    {section.items.map((item, j) => (
                      <li key={j} className="flex items-start gap-2 text-sm text-text-secondary">
                        <ChevronRight size={14} className="text-primary mt-0.5 shrink-0" />
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                );
              }
              if (section.type === "table" && section.headers && section.rows) {
                return (
                  <div key={i} className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-background-tertiary border-b border-border">
                          {section.headers.map((h, j) => (
                            <th key={j} className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {section.rows.map((row, j) => (
                          <tr key={j} className="border-b border-border last:border-0 hover:bg-background-tertiary/50 transition-colors">
                            {row.map((cell, k) => (
                              <td key={k} className="px-4 py-2.5 text-xs text-text-secondary">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }
              if (section.type === "tip") {
                return (
                  <div key={i} className="flex gap-3 bg-primary/5 border border-primary/20 rounded-lg p-4">
                    <span className="text-primary text-lg leading-none mt-0.5">💡</span>
                    <p className="text-sm text-text-secondary leading-relaxed">{section.content}</p>
                  </div>
                );
              }
              if (section.type === "warning") {
                return (
                  <div key={i} className="flex gap-3 bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
                    <span className="text-amber-400 text-lg leading-none mt-0.5">⚠️</span>
                    <p className="text-sm text-text-secondary leading-relaxed">{section.content}</p>
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>

        <footer className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveLesson(prev)}
            disabled={!prev}
            className="rounded-xl"
          >
            <ArrowLeft size={14} />
            Poprzedni
          </Button>
          {next ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                markComplete(activeLesson.id);
                setActiveLesson(next);
              }}
              className="rounded-xl"
            >
              Następny
              <ArrowRight size={14} />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                markComplete(activeLesson.id);
                setActiveLesson(null);
              }}
              className="rounded-xl text-primary border-primary/30"
            >
              Zakończ kurs 🎉
            </Button>
          )}
        </footer>
      </div>
    );
  }

  const completedCount = claudeCourse.filter((l) => completed.has(l.id)).length;
  const progressPct = Math.round((completedCount / claudeCourse.length) * 100);

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={16} />
          Wstecz
        </Button>
        <h2 className="text-sm font-medium text-text-primary">Claude — Kompletny Kurs PL</h2>
        <div className="w-20" />
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-4 mb-8 p-5 bg-background-secondary border border-border rounded-2xl">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <BookOpen size={22} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary mb-1">
                Twój postęp: {completedCount} / {claudeCourse.length} modułów
              </p>
              <div className="h-1.5 bg-background-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
            <span className="text-sm font-semibold text-primary shrink-0">{progressPct}%</span>
          </div>

          <div className="space-y-2">
            {claudeCourse.map((lesson) => {
              const isDone = completed.has(lesson.id);
              return (
                <button
                  key={lesson.id}
                  onClick={() => setActiveLesson(lesson)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-border bg-background-secondary hover:border-primary/30 hover:bg-background-tertiary transition-all text-left group"
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold transition-colors ${isDone ? "bg-primary text-black" : "bg-background-tertiary text-text-muted group-hover:bg-primary/10 group-hover:text-primary"}`}>
                    {isDone ? <CheckCircle2 size={16} /> : lesson.order}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${isDone ? "text-text-muted" : "text-text-primary"}`}>
                      {lesson.title}
                    </p>
                    <p className="text-xs text-text-muted truncate">{lesson.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="flex items-center gap-1 text-xs text-text-muted">
                      <Clock size={11} />
                      {lesson.duration}
                    </span>
                    <ArrowRight size={14} className="text-text-muted group-hover:text-primary transition-colors" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
