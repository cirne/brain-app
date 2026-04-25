import { Hono } from 'hono'
import { listSkills } from '@server/lib/llm/skillRegistry.js'

const skills = new Hono()

skills.get('/', async (c) => {
  const items = await listSkills()
  return c.json(items)
})

export default skills
