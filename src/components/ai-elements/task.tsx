import * as React from "react";

type TaskContextValue = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const TaskContext = React.createContext<TaskContextValue | null>(null);

function useTaskContext() {
  const value = React.useContext(TaskContext);
  if (!value) throw new Error("Task components must be rendered inside <Task>.");
  return value;
}

export function Task({
  defaultOpen = true,
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <TaskContext.Provider value={{ open, setOpen }}>
      <section className={`coden-task ${open ? "coden-task-open" : ""} ${className}`} {...props}>
        {children}
      </section>
    </TaskContext.Provider>
  );
}

export function TaskTrigger({
  title,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  const { open, setOpen } = useTaskContext();

  return (
    <button
      aria-expanded={open}
      className={`coden-task-trigger ${className}`}
      type="button"
      onClick={() => setOpen(current => !current)}
      {...props}
    >
      <span>{title}</span>
      <span aria-hidden="true">{open ? "-" : "+"}</span>
    </button>
  );
}

export function TaskContent({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { open } = useTaskContext();
  if (!open) return null;

  return (
    <div className={`coden-task-content ${className}`} {...props}>
      {children}
    </div>
  );
}

export function TaskItem({
  status = "pending",
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { status?: "pending" | "active" | "done" | "failed" | "cancelled" }) {
  return (
    <div className={`coden-task-item coden-task-item-${status} ${className}`} {...props}>
      <span className="coden-task-status" aria-hidden="true">
        {status === "done" ? "ok" : status === "failed" ? "!" : status === "cancelled" ? "x" : status === "active" ? ">" : "-"}
      </span>
      <span>{children}</span>
    </div>
  );
}

export function TaskItemFile({ className = "", children, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`coden-task-file ${className}`} {...props}>
      {children}
    </span>
  );
}
