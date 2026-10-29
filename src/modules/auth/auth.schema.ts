import { z } from "zod"

export const loginBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(200),
})

export type LoginBody = z.infer<typeof loginBody>
