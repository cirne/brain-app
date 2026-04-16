import { Hono } from 'hono'
import { listSkills } from '../lib/skillRegistry.js'

const skills = new Hono()

skills.get('/', async (c) => {
  const items = await listSkills()
  return c.json(items)
})

export default skills
