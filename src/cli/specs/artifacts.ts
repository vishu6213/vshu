import type { CommandSpec } from '../discovery/command-spec'
import { LOCAL_COMMAND_FLAGS } from '../arguments/args'

const CLOUD_FLAGS = ['api-url']

export const ARTIFACT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['artifacts', 'share'],
    summary: 'Share an HTML or Markdown file with your Vshu account',
    usage: 'vshu artifacts share <file> [--api-url <url>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, ...CLOUD_FLAGS, 'file'],
    positionalArgs: ['file'],
    examples: ['vshu artifacts share ./report.html', 'vshu artifacts share ./notes.md --json']
  },
  {
    path: ['artifacts', 'update'],
    summary: 'Update a file previously shared from this Vshu profile',
    usage: 'vshu artifacts update <file> [--api-url <url>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, ...CLOUD_FLAGS, 'file'],
    positionalArgs: ['file']
  },
  {
    path: ['artifacts', 'unshare'],
    destructive: true,
    summary: 'Delete the artifact associated with a previously shared file',
    usage: 'vshu artifacts unshare <file> [--api-url <url>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, ...CLOUD_FLAGS, 'file'],
    positionalArgs: ['file']
  },
  {
    path: ['artifacts', 'list'],
    summary: 'List artifacts owned by the signed-in Vshu account',
    usage: 'vshu artifacts list [--cursor <cursor>] [--api-url <url>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, ...CLOUD_FLAGS, 'cursor']
  },
  {
    path: ['artifacts', 'delete'],
    aliases: [['artifacts', 'rm']],
    destructive: true,
    summary: 'Delete an artifact owned by the signed-in Vshu account',
    usage: 'vshu artifacts delete <id> [--api-url <url>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, ...CLOUD_FLAGS, 'id'],
    positionalArgs: ['id']
  }
]
