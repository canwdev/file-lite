import {Hono} from 'hono'

const filesRouter = new Hono()

// 列出文件夹内容
filesRouter.get('/list', async (c) => {
  const {path} = c.req.query()
  return c.json({path})
})

export {filesRouter}
