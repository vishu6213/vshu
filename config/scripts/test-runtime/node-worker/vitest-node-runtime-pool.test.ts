import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { expect, it, onTestFinished } from 'vitest'
import { createVitest } from 'vitest/node'

import { nodeRuntimePool } from './vitest-node-runtime-pool'

it('reports a test file that fails to load as a failed file instead of crashing the run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vshu-node-runtime-pool-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'load-failure.test.ts'), "import './vshu-missing-module'\n")
  const nested = await createVitest(
    'test',
    {
      config: false,
      watch: false,
      dir,
      include: ['**/*.test.ts'],
      pool: 'node-runtime',
      poolRunner: nodeRuntimePool,
      reporters: [],
      env: { VSHU_TEST_NODE_EXECUTABLE: process.execPath }
    },
    {},
    { stdout: new PassThrough(), stderr: new PassThrough() }
  )
  try {
    await nested.start()
    const [file] = nested.state.getFiles()
    expect(file.result?.state).toBe('fail')
    expect(file.result?.errors?.[0]?.message).toContain('vshu-missing-module')
    expect(nested.state.getUnhandledErrors()).toEqual([])
  } finally {
    await nested.close()
  }
})
