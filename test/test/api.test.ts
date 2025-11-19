import request from 'supertest'
import {expect} from 'chai'
import * as path from 'node:path'
import * as fs from "node:fs";
import {fileURLToPath} from 'url';
import {dirname} from 'path';

const m_filename = fileURLToPath(import.meta.url);
const m_dirname = dirname(m_filename);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const testConfig = JSON.parse(fs.readFileSync(path.join(m_dirname, '../../backend/data/config.json')) as any) as any

const BASE_URL = `${testConfig.sslKey ? 'https' : 'http'}://${testConfig.host || '127.0.0.1'}:${testConfig.port || '3111'}`

// 创建 Supertest 实例
const api = request(BASE_URL)

describe('接口测试', () => {
  // ... 具体的测试用例

  it('登录：无Authorization头', async () => {
    const response = await api.get('/api/files/auth')
      .expect('Content-Type', /json/) // 期望响应类型是 JSON

    // 判断noAuth，如果为true，返回200
    if (testConfig.noAuth) {
      expect(response.status).to.equal(200)
    } else {
      expect(response.status).to.equal(401)
    }

    // Chai 断言：检查响应体是否是一个对象
    expect(response.body).to.be.an('object')
  })

  it('登录：Authorization头错误', async () => {
    const response = await api.get('/api/files/auth')
      .set('Authorization', '__test_error__')
      .expect('Content-Type', /json/)

    // 判断noAuth，如果为true，返回200
    if (testConfig.noAuth) {
      expect(response.status).to.equal(200)
    } else {
      expect(response.status).to.equal(401)
    }

    expect(response.body).to.be.an('object')
  })

  it('登录：Authorization头正确', async () => {
    const response = await api.get('/api/files/auth')
      .set('Authorization', testConfig.password)
      .expect('Content-Type', /json/)
      .expect(200)

    expect(response.body).to.be.an('object')
  })

  it('磁盘列表', async () => {
    const response = await api.get('/api/files/drives')
      .set('Authorization', testConfig.password)
      .expect('Content-Type', /json/)
      .expect(200)

    expect(response.body).to.be.an('array')
    // 检查数组是否非空
    expect(response.body.length).to.be.greaterThan(0)
    // 检查数组中的每个元素是否有 'path' 属性
    response.body.forEach((drive) => {
      expect(drive).to.have.property('path')
    })
  })

  if (testConfig.safeBaseDir) {
    const illegalPath = path.resolve('/')
    it(`文件列表：非法路径 ${illegalPath}`, async () => {
      const response = await api.get('/api/files/list')
        .set('Authorization', testConfig.password)
        .query({
          path: illegalPath,
        })
        .expect('Content-Type', /json/)
        .expect(400)
    })
  }

  const legalPath = path.resolve(m_dirname, '../../backend', testConfig.safeBaseDir || 'data')
  it(`文件列表：${legalPath}`, async () => {

    const response = await api.get('/api/files/list')
      .set('Authorization', testConfig.password)
      .query({
        path: legalPath,
      })
      .expect('Content-Type', /json/)
      .expect(200)

    expect(response.body).to.be.an('array')
  })

  it('创建 test 文件夹', async () => {
    const response = await api.post('/api/files/create-dir')
      .set('Authorization', testConfig.password)
      .send({
        path: path.join(legalPath, 'test'),
      })
      .expect('Content-Type', /json/)
      .expect(200)

    expect(response.body).to.be.an('object')
  })

  const testUploadModify = (fileContent: string) => {
    const filename = 'test file.txt'
    const targetPath = path.join(legalPath, 'test', filename)
    const localFilePath = path.join(m_dirname, filename)


    it(`上传/修改文件: ${targetPath} | ${fileContent}`, async () => {
      fs.writeFileSync(localFilePath, fileContent, 'utf-8')
      const response = await api.post('/api/files/upload-file')
        .set('Authorization', testConfig.password)
        .attach('file', localFilePath)
        .query({
          path: targetPath,
        })
        .expect('Content-Type', /json/)
        .expect(200)

      expect(response.body).to.be.an('object')
    })

    it(`确保文件内容一致: ${fileContent}`, async () => {
      const response = await api.get('/api/files/stream')
        .set('Authorization', testConfig.password)
        .query({
          path: targetPath,
          t: Date.now()
        })
        .expect('Content-Type', /text\/plain/)
        .expect(200)
      expect(response.text).to.contain(fileContent)
    })
  }
  testUploadModify('hello world! test file.')
  testUploadModify('modified test file.')
})
