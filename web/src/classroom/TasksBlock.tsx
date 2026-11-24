import { points, type Assignment } from '@/api'

export function TasksBlock({ assignment }: { assignment: Assignment }) {
  const total = assignment.tasks.reduce((sum, task) => sum + task.max, 0)
  return (
    <div className="min-w-0 flex-1 basis-56">
      <p className="mb-1 text-xs font-semibold text-muted-foreground">Максимум за задачи</p>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        {assignment.tasks.map((task) => <li key={task.number} className="whitespace-nowrap">
          Задача {task.number} · <span className="font-medium text-primary">{points(task.max)} б.</span>
        </li>)}
        {assignment.tasks.length > 1 && <li className="whitespace-nowrap font-semibold">Всего {points(total)} б.</li>}
      </ul>
    </div>
  )
}
