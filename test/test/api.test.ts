import request from 'supertest'
import {expect} from 'chai'
import * as path from 'node:path'
import * as fs from "node:fs";
import {fileURLToPath} from 'url';
import {dirname} from 'path';
import type {IEntry} from "@frontend/types/server.ts";

const m_dirname = dirname(fileURLToPath(import.meta.url));

const testConfig = JSON.parse(fs.readFileSync(path.join(m_dirname, '../../backend/data/config.json')) as any) as any

const BASE_URL = `${testConfig.sslKey ? 'https' : 'http'}://${testConfig.host || '127.0.0.1'}:${testConfig.port || '3111'}`

// 创建 Supertest 实例
const api = request(BASE_URL)

describe('鉴权', () => {

  it('无Authorization头', async () => {
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

  it('Authorization头错误', async () => {
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

  it('Authorization头正确', async () => {
    const response = await api.get('/api/files/auth')
      .set('Authorization', testConfig.password)
      .expect('Content-Type', /json/)
      .expect(200)

    expect(response.body).to.be.an('object')
  })
})


describe('文件管理', () => {

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

  const legalPath = path.resolve(m_dirname, '../../backend', testConfig.safeBaseDir || 'data')
  const testFolderName = 'F01 测试文件夹'
  const testFilename = '.A01 测试文件.txt'

  if (testConfig.safeBaseDir) {
    const illegalPath = path.resolve('/')
    it(`访问非法路径：${illegalPath}`, async () => {
      const response = await api.get('/api/files/list')
        .set('Authorization', testConfig.password)
        .query({
          path: illegalPath,
        })
        .expect('Content-Type', /json/)
        .expect(400)
    })
  }

  it(`访问合法路径：${legalPath}`, async () => {

    const response = await api.get('/api/files/list')
      .set('Authorization', testConfig.password)
      .query({
        path: legalPath,
      })
      .expect('Content-Type', /json/)
      .expect(200)

    expect(response.body).to.be.an('array')
  })

  const testCreateFolder = (folderName: string) => {
    it(`创建并检测文件夹：${folderName}`, async () => {
      // 创建文件夹
      const response = await api.post('/api/files/create-dir')
        .set('Authorization', testConfig.password)
        .send({
          path: path.join(legalPath, folderName),
        })
        .expect('Content-Type', /json/)
      expect(response.status).to.be.oneOf([200, 201])
      expect(response.body).to.be.an('object')

      // 检测文件夹是否存在
      const response2 = await api.get('/api/files/list')
        .set('Authorization', testConfig.password)
        .query({
          path: legalPath,
        })
        .expect('Content-Type', /json/)
        .expect(200)

      expect(response2.body).to.be.an('array')
      expect(response2.body.length).to.be.greaterThan(0)

      const entry = response2.body.find((file: IEntry) => file.name === folderName)
      expect(entry).to.have.property('name').that.is.a('string')
      expect(entry).to.have.property('isDirectory').that.is.a('boolean').and.equals(true)
      expect(entry).to.have.property('error').that.is.null
      expect(entry).to.not.be.undefined
    })
  }
  const testUploadModify = (folderName: string, filename: string, fileContent: string) => {

    it(`上传/修改文件并检测内容: ${folderName}/${filename} | ${fileContent}`, async () => {
      const targetPath = path.join(legalPath, folderName, filename)
      const localFilePath = path.join(m_dirname, filename)

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

      // 检测文件内容是否正确
      const response2 = await api.get('/api/files/stream')
        .set('Authorization', testConfig.password)
        .query({
          path: targetPath,
          t: Date.now()
        })
        .expect('Content-Type', /text\/plain/)
        .expect(200)
      expect(response2.text).to.contain(fileContent)
    })

    it(`检测文件属性：${folderName}/${filename}`, async () => {
      const targetPath = path.join(legalPath, folderName)
      const response = await api.get('/api/files/list')
        .set('Authorization', testConfig.password)
        .query({
          path: targetPath,
        })
        .expect('Content-Type', /json/)
        .expect(200)
      expect(response.body).to.be.an('array')
      // 检查数组是否非空
      expect(response.body.length).to.be.greaterThan(0)
      // 检查数组中是否有 filename
      const entry = response.body.find((file: IEntry) => file.name === filename)

      expect(entry).to.have.property('name').that.is.a('string')
      expect(entry).to.have.property('isDirectory').that.is.a('boolean').and.equals(false)

      expect(entry).to.have.property('error').that.is.null
      expect(entry).to.not.be.undefined
    })
  }

  describe('创建', () => {
    testCreateFolder(testFolderName)

    testUploadModify(testFolderName, testFilename, 'hello world!')
    testUploadModify(testFolderName, testFilename, 'modified test file.')
  })

  const testDelete = (folderName: string, filename: string) => {
    const targetPath = path.join(legalPath, folderName, filename)
    it(`删除文件/文件夹：${targetPath}`, async () => {
      const response = await api.post('/api/files/delete')
        .set('Authorization', testConfig.password)
        .send({
          path: [targetPath],
        })
        .expect('Content-Type', /json/)
        .expect(200)
      expect(response.body).to.be.an('object')

      // 检测文件是否已删除
      const response2 = await api.get('/api/files/list')
        .set('Authorization', testConfig.password)
        .query({
          path: path.join(legalPath, folderName),
        })
        .expect('Content-Type', /json/)
        .expect(200)
      expect(response2.body).to.be.an('array')
      const entry = response2.body.find((file: IEntry) => file.name === filename)
      expect(entry).to.be.undefined
    })
  }

  describe('删除', () => {
    testDelete(testFolderName, testFilename)
    testDelete('', testFolderName)

    const toBeDeletedFolder = '.to Be Deleted Folder'
    testCreateFolder(toBeDeletedFolder)
    testUploadModify(toBeDeletedFolder, testFilename, 'hello world! test file.')
    testDelete('', toBeDeletedFolder)
  })
})
