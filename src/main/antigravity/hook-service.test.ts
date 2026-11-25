import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn<() => string>()
}))

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as Record<string, unknown>
  return {
    ...actual,
    homedir: homedirMock
  }
})

import { AntigravityHookService } from './hook-service'
import { createManagedCommandMatcher } from '../agent-hooks/installation/commands/managed-hook-command-matching'

const ANTIGRAVITY_PRE_INVOCATION_COMMAND =
  process.platform === 'win32' ? 'antigravity-pre-invocation.cmd' : 'antigravity-hook.sh'
const ANTIGRAVITY_POST_TOOL_USE_COMMAND =
  process.platform === 'win32' ? 'antigravity-post-tool-use.cmd' : 'antigravity-hook.sh'
const ANTIGRAVITY_PRE_TOOL_USE_COMMAND =
  process.platform === 'win32' ? 'antigravity-pre-tool-use.cmd' : 'antigravity-hook.sh'

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  try {
    return run()
  } finally {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  }
}

describe('AntigravityHookService', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'vshu-antigravity-home-'))
    homedirMock.mockReturnValue(homeDir)
  })

  afterEach(() => {
    vi.clearAllMocks()
    rmSync(homeDir, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')(
    "prints nothing for PreToolUse so agy's own permission policy decides",
    () => {
      new AntigravityHookService().install()

      const result = spawnSync(
        '/bin/sh',
        [join(homeDir, '.vshu', 'agent-hooks', 'antigravity-hook.sh')],
        {
          env: {
            ...process.env,
            VSHU_ANTIGRAVITY_EVENT: 'PreToolUse',
            VSHU_AGENT_HOOK_ENDPOINT: '',
            VSHU_AGENT_HOOK_PORT: '',
            VSHU_AGENT_HOOK_TOKEN: '',
            VSHU_PANE_KEY: ''
          },
          input: '{"toolCall":{"name":"run_command","args":{"CommandLine":"ls"}}}',
          encoding: 'utf8'
        }
      )

      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
    }
  )

  it.skipIf(process.platform === 'win32')(
    'stays silent for PreToolUse when the managed script is missing',
    () => {
      new AntigravityHookService().install()
      rmSync(join(homeDir, '.vshu', 'agent-hooks'), { recursive: true, force: true })

      const config = JSON.parse(
        readFileSync(join(homeDir, '.gemini', 'config', 'hooks.json'), 'utf8')
      ) as { 'vshu-status': Record<string, { hooks?: { command: string }[] }[]> }
      const command = config['vshu-status'].PreToolUse[0].hooks?.[0]?.command

      const result = spawnSync('/bin/sh', ['-c', command!], {
        input: '{"toolCall":{"name":"run_command"}}',
        encoding: 'utf8'
      })

      // Config under .gemini can outlive managed scripts under .vshu.
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
    }
  )

  it.skipIf(process.platform === 'win32')(
    'answers non-gate Antigravity events like the managed script when it is missing',
    () => {
      new AntigravityHookService().install()
      rmSync(join(homeDir, '.vshu', 'agent-hooks'), { recursive: true, force: true })

      const config = JSON.parse(
        readFileSync(join(homeDir, '.gemini', 'config', 'hooks.json'), 'utf8')
      ) as {
        'vshu-status': Record<string, { command?: string; hooks?: { command: string }[] }[]>
      }
      const postToolUse = config['vshu-status'].PostToolUse[0].hooks?.[0]?.command
      const preInvocation = config['vshu-status'].PreInvocation[0].command

      for (const command of [postToolUse, preInvocation]) {
        const result = spawnSync('/bin/sh', ['-c', command!], { input: '{}', encoding: 'utf8' })
        expect(result.status).toBe(0)
        expect(result.stdout).toBe('{}\n')
      }
    }
  )

  it('preserves the installed core and config when publishing the Windows reader fails', () => {
    withPlatform('win32', () => {
      const service = new AntigravityHookService()
      expect(service.install().state).toBe('installed')
      const hookDir = join(homeDir, '.vshu', 'agent-hooks')
      const readerPath = join(hookDir, 'antigravity-hook-post.cjs')
      const corePath = join(hookDir, 'antigravity-hook.cmd')
      const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
      writeFileSync(corePath, 'previous installed core')
      const previousConfig = readFileSync(configPath, 'utf8')
      rmSync(readerPath)
      mkdirSync(readerPath)

      expect(() => service.install()).toThrow()
      expect(readFileSync(corePath, 'utf8')).toBe('previous installed core')
      expect(readFileSync(configPath, 'utf8')).toBe(previousConfig)
    })
  })

  it('publishes the native reader into a Windows install that predates it on startup refresh', async () => {
    const service = new AntigravityHookService()
    withPlatform('win32', () => expect(service.install().state).toBe('installed'))
    const exePath = join(homeDir, '.vshu', 'agent-hooks', 'vshu-agent-hook.exe')
    expect(existsSync(exePath)).toBe(false)
    const resourcesPath = join(homeDir, 'resources')
    mkdirSync(join(resourcesPath, 'bin'), { recursive: true })
    writeFileSync(join(resourcesPath, 'bin', 'vshu-agent-hook.exe'), 'bundled native hook')

    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resourcesPath })
    try {
      await service.refreshManagedScripts()
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform)
      }
      Reflect.deleteProperty(process, 'resourcesPath')
    }

    expect(readFileSync(exePath, 'utf8')).toBe('bundled native hook')
  })

  it('preserves user-authored hook bundles and entries in Vshu bundle', () => {
    const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          'user-hook': {
            PreInvocation: [{ type: 'command', command: '/usr/local/bin/user-hook' }]
          },
          'vshu-status': {
            PreInvocation: [{ type: 'command', command: '/usr/local/bin/vshu-extra' }]
          }
        },
        null,
        2
      )}\n`
    )

    new AntigravityHookService().install()

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      'user-hook': { PreInvocation: { command: string }[] }
      'vshu-status': { PreInvocation: { command: string }[] }
    }
    expect(config['user-hook'].PreInvocation[0].command).toBe('/usr/local/bin/user-hook')
    const commands = config['vshu-status'].PreInvocation.map((entry) => entry.command)
    expect(commands).toContain('/usr/local/bin/vshu-extra')
    expect(commands.some((command) => command.includes(ANTIGRAVITY_PRE_INVOCATION_COMMAND))).toBe(
      true
    )
  })

  it('removes stale managed Antigravity hook entries from retired events', () => {
    const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          'vshu-status': {
            OldEvent: [
              {
                type: 'command',
                command: '/tmp/old/agent-hooks/antigravity-hook.sh'
              }
            ],
            PreToolUse: [
              {
                matcher: '*',
                hooks: [{ type: 'command', command: '/tmp/old/agent-hooks/antigravity-hook.sh' }]
              }
            ]
          }
        },
        null,
        2
      )}\n`
    )

    new AntigravityHookService().install()

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      'vshu-status': Record<string, { command?: string; hooks?: { command: string }[] }[]>
    }
    expect(config['vshu-status'].OldEvent).toBeUndefined()
    const preToolCommands = config['vshu-status'].PreToolUse.flatMap((definition) =>
      (definition.hooks ?? []).map((hook) => hook.command)
    )
    expect(preToolCommands).toHaveLength(1)
    expect(preToolCommands[0]).toContain(
      join(homeDir, '.vshu', 'agent-hooks', ANTIGRAVITY_PRE_TOOL_USE_COMMAND).replaceAll('\\', '/')
    )
    expect(preToolCommands[0]).not.toContain('/tmp/old/agent-hooks/antigravity-hook.sh')
    const commands = config['vshu-status'].PostToolUse.flatMap((definition) =>
      (definition.hooks ?? []).map((hook) => hook.command)
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain(
      join(homeDir, '.vshu', 'agent-hooks', ANTIGRAVITY_POST_TOOL_USE_COMMAND).replaceAll('\\', '/')
    )
  })

  it('replaces legacy backslash Windows entries and keeps user hooks', () => {
    withPlatform('win32', () => {
      const configPath = join(homeDir, '.gemini', 'config', 'hooks.json')
      // Git Bash strips backslashes from legacy bare paths.
      const legacyStop = 'C:\\Users\\ada\\.vshu\\agent-hooks\\antigravity-stop.cmd'
      const legacyPreToolUse = 'C:\\Users\\ada\\.vshu\\agent-hooks\\antigravity-pre-tool-use.cmd'
      const userHook = { type: 'command', command: 'C:\\tools\\user-hook.cmd' }
      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(
        configPath,
        `${JSON.stringify({
          'vshu-status': {
            Stop: [{ type: 'command', command: legacyStop }, userHook],
            PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: legacyPreToolUse }] }]
          }
        })}\n`
      )

      const service = new AntigravityHookService()
      expect(service.getStatus().state).toBe('partial')
      expect(service.install().state).toBe('installed')

      const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
        'vshu-status': Record<string, { command?: string; hooks?: { command: string }[] }[]>
      }
      const [keptUserHook, stop] = config['vshu-status'].Stop
      expect(config['vshu-status'].Stop).toHaveLength(2)
      expect(keptUserHook).toEqual(userHook)
      expect(stop.command).not.toBe(legacyStop)
      expect(createManagedCommandMatcher('antigravity-stop.cmd')(stop.command)).toBe(true)
      const preToolUse = config['vshu-status'].PreToolUse.flatMap((d) => d.hooks ?? [])
      expect(preToolUse).toHaveLength(1)
      expect(preToolUse[0].command).not.toBe(legacyPreToolUse)
    })
  })
})
