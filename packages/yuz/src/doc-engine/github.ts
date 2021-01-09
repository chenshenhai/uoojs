import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import compose from 'koa-compose';
import { TypeDocEngine, TypeDocEngineResult, TypeDocEngineOptions, TypeDocEngineStep, TypeDocEngineProcessParams, TypeDocSnapshot } from '../types';
import { makeFullDir, removeFullDir, writeJson } from '../util/file';
import { cloneRepo, pullRepo } from '../util/github';
import { getNowDateList } from './../util/date';
import { Reader } from './reader';
import { Writer } from './writer';


export class GithubDocEngine extends EventEmitter implements TypeDocEngine {
  
  private _opts: TypeDocEngineOptions;
  private _step: TypeDocEngineStep = 'FREE';
  private _tasks: Array<(ctx: TypeDocEngineResult, next: Function) => Promise<any>> = [];
  private _remoteDir: string;
  private _snapshotDir: string;
  private _postsDir: string;
  private _imagesDir: string;

  private _reader: Reader = new Reader();
  private _writer: Writer = new Writer();

  constructor(opts: TypeDocEngineOptions) {
    super();
    this._opts = opts;

    const { baseDir } = this._opts;
    const remoteDir = path.join(baseDir, 'remote');
    const snapshotDir = path.join(baseDir, 'snapshot');
    const postsDir = path.join(baseDir, 'posts');
    const imagesDir = path.join(baseDir, 'images');
    makeFullDir(remoteDir);
    makeFullDir(snapshotDir);
    makeFullDir(postsDir);
    makeFullDir(imagesDir);
    this._remoteDir = remoteDir;
    this._snapshotDir = snapshotDir;
    this._postsDir = postsDir;
    this._imagesDir = imagesDir;
  }

   getStatus(): TypeDocEngineStep {
    return this._step;
  }

  async process(params: TypeDocEngineProcessParams): Promise<TypeDocEngineResult> {
    this._tasks = [];
    const { remote, docType } = params;

    // | 'LOAD_REMOTE_DOC'
    // | 'PULL_REMOTE_DOC'
    // | 'READ_LAST_DOC_SNAPSHOT'
    // | 'CREATE_DOC_SNAPSHOT'
    // | 'DIFF_DOC_SNAPSHOT'
    // | 'REFRESH_DOC_POSTS';

    this._pushTaskLoadRemoteDoc(params);
    this._pushTaskPullRemoteDoc(params);
    this._pushTaskReadLastDocSnapshot(params);
    this._pushTaskCreateDocSnapshot(params);
    this._pushTaskDiffDocSnapshot(params);
    this._pushTaskRefreshDoc(params);

    const result = {
      steps: [],
      stepMap: {},
      remote,
      docType,
    }

    await compose(this._tasks)(result);

    return result
  }

  private async _pushTaskLoadRemoteDoc(params: TypeDocEngineProcessParams) {
    const { remote } = params;
    const { user, repository } = remote;
    this._tasks.push(async (ctx: TypeDocEngineResult, next: Function) => {
      const localPath = path.join(this._remoteDir, 'gitub', user, repository);
      let res = null;
      if (!(fs.existsSync(localPath) && fs.statSync(localPath).isDirectory())) {
        res = await cloneRepo({
          user,
          repository,
          localPath,
        });
      }
      const step = 'LOAD_REMOTE_DOC';
      ctx.steps.push(step);
      ctx.stepMap[step] = {
        step,
        success: true,
        data: res
      }
      await next();
    });
  }

  private async _pushTaskPullRemoteDoc(params: TypeDocEngineProcessParams) {
    const { remote } = params;
    const { user, repository } = remote;
    this._tasks.push(async (ctx: TypeDocEngineResult, next: Function) => {
      const localPath = path.join(this._remoteDir, 'gitub', user, repository);
      let res = null;
      if (fs.existsSync(localPath) && fs.statSync(localPath).isDirectory()) {
        res = await pullRepo({
          localPath,
        });
      }
      const step = 'PULL_REMOTE_DOC';
      ctx.steps.push(step);
      ctx.stepMap[step] = {
        step,
        success: true,
        data: res
      }
      await next();
    });
  }

  private async _pushTaskCreateDocSnapshot(params: TypeDocEngineProcessParams) {
    const { remote, docType } = params;
    const { user, repository } = remote;
    this._tasks.push(async (ctx: TypeDocEngineResult, next: Function) => {
      const localPath = path.join(this._remoteDir, 'gitub', user, repository);
      const snapshot = await this._reader.createSnapshot(localPath, { type: docType, name: `gitub/${user}/${repository}` });
      const dateList = getNowDateList();
      const snapshotDir = path.join(this._snapshotDir, ...dateList);
      const snapshotPath = path.join(snapshotDir, `${Date.now()}.json`);
      makeFullDir(snapshotDir)
      writeJson(snapshotPath, snapshot);
      // const res = await this._writer.writePosts(listInfo, { storagePath: this._postsDir });
      const step = 'CREATE_DOC_SNAPSHOT';
      ctx.steps.push(step);
      ctx.stepMap[step] = {
        step,
        success: true,
        data: snapshot
      }
      await next();
    });
  }

  private async _pushTaskReadLastDocSnapshot(params: TypeDocEngineProcessParams) {
    this._tasks.push(async (ctx: TypeDocEngineResult, next: Function) => {
      const snapshot = await this._reader.readLastSnapshot(this._snapshotDir);
      const step = 'READ_LAST_DOC_SNAPSHOT';
      ctx.steps.push(step);
      ctx.stepMap[step] = {
        step,
        success: true,
        data: snapshot
      }
      await next();
    });
  }

  private async _pushTaskDiffDocSnapshot(params: TypeDocEngineProcessParams) {
    this._tasks.push(async (ctx: TypeDocEngineResult, next: Function) => {
      const step = 'DIFF_DOC_SNAPSHOT';
      const before: TypeDocSnapshot|null = ctx.stepMap['READ_LAST_DOC_SNAPSHOT'].data as TypeDocSnapshot|null;
      const after: TypeDocSnapshot = ctx.stepMap['CREATE_DOC_SNAPSHOT'].data as TypeDocSnapshot;
      const diff = await this._reader.diffSnapshot(before, after);
      ctx.steps.push(step);
      ctx.stepMap[step] = {
        step,
        success: true,
        data: diff
      }
      await next();
    });
  }

  private async _pushTaskRefreshDoc(params: TypeDocEngineProcessParams) {
    // const { remote, docType } = params;
    // const { user, repository } = remote;
    this._tasks.push(async (ctx: TypeDocEngineResult, next: Function) => {
      const snapshot = ctx.stepMap['CREATE_DOC_SNAPSHOT'].data;
      const res = await this._writer.writePosts(snapshot, { postsDir: this._postsDir, remoteDir: this._remoteDir });
      const step = 'CREATE_DOC_SNAPSHOT';
      ctx.steps.push(step);
      ctx.stepMap[step] = {
        step,
        success: true,
        data: res
      }
      await next();
    });
  }

  

}