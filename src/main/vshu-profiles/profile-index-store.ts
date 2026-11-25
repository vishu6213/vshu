import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { writeRollingFileBackup } from '../filesystem/rolling-file-backup'
import {
  bestEffortFsyncDirectorySync,
  fsyncFileSync
} from '../../shared/secure-storage/secure-file'
import {
  createDefaultLocalVshuProfile,
  DEFAULT_LOCAL_VSHU_PROFILE_ID,
  DEFAULT_LOCAL_VSHU_PROFILE_NAME,
  VSHU_PROFILE_INDEX_SCHEMA_VERSION,
  type CreateLocalVshuProfileArgs,
  type CreateLocalVshuProfileResult,
  type VshuProfileIndex,
  type VshuProfileListState,
  type VshuProfileSummary
} from '../../shared/vshu-profiles/vshu-profiles'
import {
  getVshuProfileDataFile,
  getVshuProfileDirectory,
  getVshuProfileIndexPath,
  getVshuProfileStateDatabaseFile,
  hasVshuProfileStateDatabase,
  getProfileUserDataPath
} from './profile-storage-paths'
import { copyLegacyStateToProfile } from './storage/profile-legacy-state-import'
import { supersedeCloudConnectAttempts } from './cloud-auth/profile-cloud-connect-attempts'
import { observeActiveTeamProfile } from './cloud-auth/active-team-capabilities'
import { profileStateJsonExportPaths } from '../persistence/profile-state/legacy-json/profile-state-export-path'
import { hasProfileStateAuthorityMarker } from '../persistence/profile-state/database/profile-state-authority-marker'
import { profileStateDatabaseBackups } from '../persistence/profile-state/backup/profile-state-backup-path'

export type ActiveVshuProfileState = {
  index: VshuProfileIndex
  profile: VshuProfileSummary
  dataFile: string
  stateDatabaseFile: string
  profileDirectory: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProfileSummary(value: unknown): value is VshuProfileSummary {
  if (!isObject(value)) {
    return false
  }
  const avatar = value.avatar
  const cloud = value.cloud
  return (
    typeof value.id === 'string' &&
    // Index IDs become path segments; reject traversal outside the profile directory.
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.id) &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    (value.kind === 'local' || value.kind === 'cloud-linked') &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number' &&
    typeof value.lastOpenedAt === 'number' &&
    isObject(avatar) &&
    avatar.kind === 'initials' &&
    typeof avatar.initials === 'string' &&
    avatar.color === 'neutral' &&
    (cloud === undefined || isObject(cloud))
  )
}

function normalizeProfileIndex(raw: unknown): VshuProfileIndex | null {
  if (!isObject(raw) || !Array.isArray(raw.profiles)) {
    return null
  }
  const profiles = raw.profiles.filter(isProfileSummary)
  const activeProfileId =
    typeof raw.activeProfileId === 'string' &&
    profiles.some((profile) => profile.id === raw.activeProfileId)
      ? raw.activeProfileId
      : profiles[0]?.id
  if (!activeProfileId) {
    return null
  }
  return {
    schemaVersion: VSHU_PROFILE_INDEX_SCHEMA_VERSION,
    activeProfileId,
    profiles
  }
}

function sanitizeProfileName(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed.slice(0, 80) : 'New Profile'
}

function readProfileIndexFile(indexPath: string): VshuProfileIndex | null {
  try {
    return normalizeProfileIndex(JSON.parse(readFileSync(indexPath, 'utf-8')))
  } catch {
    return null
  }
}

export function readProfileIndex(indexPath: string): VshuProfileIndex | null {
  // Recover from backup rather than orphan other profiles by resetting a corrupt index.
  return readProfileIndexFile(indexPath) ?? readProfileIndexFile(`${indexPath}.bak`)
}

function readExistingProfileIndex(indexPath: string): VshuProfileIndex | null {
  const index = readProfileIndex(indexPath)
  if (!index && (existsSync(indexPath) || existsSync(`${indexPath}.bak`))) {
    throw new Error(`Could not read active profile index ${indexPath}`)
  }
  return index
}

export function writeProfileIndex(indexPath: string, index: VshuProfileIndex): void {
  mkdirSync(dirname(indexPath), { recursive: true })
  // Never replace the recovery backup with a corrupt primary index.
  if (existsSync(indexPath) && readProfileIndexFile(indexPath)) {
    try {
      writeRollingFileBackup(indexPath, `${indexPath}.bak`)
    } catch {
      // Backup failure must not block the primary write.
    }
  }
  const tmpPath = `${indexPath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(index, null, 2), 'utf-8')
  fsyncFileSync(tmpPath)
  renameSync(tmpPath, indexPath)
  const active = index.profiles.find((profile) => profile.id === index.activeProfileId)
  if (active) {
    observeActiveTeamProfile(dirname(indexPath), active)
  }
  bestEffortFsyncDirectorySync(dirname(indexPath))
}

function createInitialProfileIndex(now = Date.now()): VshuProfileIndex {
  const profile = createDefaultLocalVshuProfile(now)
  return {
    schemaVersion: VSHU_PROFILE_INDEX_SCHEMA_VERSION,
    activeProfileId: profile.id,
    profiles: [profile]
  }
}

export function loadOrCreateProfileIndex(userDataPath: string): VshuProfileIndex {
  const indexPath = getVshuProfileIndexPath(userDataPath)
  const index = readExistingProfileIndex(indexPath)
  if (index) {
    return index
  }
  const nextIndex = createInitialProfileIndex()
  writeProfileIndex(indexPath, nextIndex)
  return nextIndex
}

function getActiveProfile(index: VshuProfileIndex): VshuProfileSummary {
  return (
    index.profiles.find((profile) => profile.id === index.activeProfileId) ??
    index.profiles[0] ??
    createDefaultLocalVshuProfile(Date.now())
  )
}

export function ensureActiveVshuProfile(
  userDataPath = getProfileUserDataPath()
): ActiveVshuProfileState {
  const indexPath = getVshuProfileIndexPath(userDataPath)
  let index = readExistingProfileIndex(indexPath)
  let shouldWriteIndex = !existsSync(indexPath)

  if (!index) {
    index = createInitialProfileIndex()
    shouldWriteIndex = true
  }

  const activeProfile = getActiveProfile(index)
  if (activeProfile.id !== index.activeProfileId) {
    index = { ...index, activeProfileId: activeProfile.id }
    shouldWriteIndex = true
  }

  const profileDirectory = getVshuProfileDirectory(activeProfile.id, userDataPath)
  mkdirSync(profileDirectory, { recursive: true })
  const profileDatabaseFile = getVshuProfileStateDatabaseFile(activeProfile.id, userDataPath)
  const profileDataFile = getVshuProfileDataFile(activeProfile.id, userDataPath)
  let hasRetainedProfileStateAuthority = false
  try {
    hasRetainedProfileStateAuthority =
      hasProfileStateAuthorityMarker(profileDatabaseFile) ||
      profileStateJsonExportPaths(profileDataFile).length > 0 ||
      profileStateDatabaseBackups(profileDatabaseFile).length > 0
  } catch {
    // An unreadable profile directory must never trigger a fallback copy of legacy state.
    hasRetainedProfileStateAuthority = true
  }
  if (
    activeProfile.id === DEFAULT_LOCAL_VSHU_PROFILE_ID &&
    !hasVshuProfileStateDatabase(activeProfile.id, userDataPath) &&
    !hasRetainedProfileStateAuthority
  ) {
    copyLegacyStateToProfile(userDataPath, activeProfile.id)
  }

  if (shouldWriteIndex) {
    writeProfileIndex(indexPath, index)
  }

  return {
    index,
    profile: activeProfile,
    dataFile: profileDataFile,
    stateDatabaseFile: profileDatabaseFile,
    profileDirectory
  }
}

export function isDefaultLocalVshuProfileId(profileId: string): boolean {
  return profileId === DEFAULT_LOCAL_VSHU_PROFILE_ID
}

export function getVshuProfileListState(
  userDataPath = getProfileUserDataPath()
): VshuProfileListState {
  const { index } = ensureActiveVshuProfile(userDataPath)
  return {
    activeProfileId: index.activeProfileId,
    profiles: index.profiles
  }
}

export function createLocalVshuProfile(
  args: CreateLocalVshuProfileArgs = {},
  userDataPath = getProfileUserDataPath()
): CreateLocalVshuProfileResult {
  const index = loadOrCreateProfileIndex(userDataPath)
  const now = Date.now()
  const name = sanitizeProfileName(args.name)
  const profile: VshuProfileSummary = {
    id: `local-${randomUUID()}`,
    name,
    avatar: {
      kind: 'initials',
      initials: (
        name.match(/[A-Za-z0-9]/)?.[0] ?? DEFAULT_LOCAL_VSHU_PROFILE_NAME[0]
      ).toUpperCase(),
      color: 'neutral'
    },
    kind: 'local',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  }
  const nextIndex: VshuProfileIndex = {
    ...index,
    profiles: [...index.profiles, profile]
  }
  mkdirSync(getVshuProfileDirectory(profile.id, userDataPath), { recursive: true })
  writeProfileIndex(getVshuProfileIndexPath(userDataPath), nextIndex)
  return {
    activeProfileId: nextIndex.activeProfileId,
    profiles: nextIndex.profiles,
    profile
  }
}

export function setActiveVshuProfile(
  profileId: string,
  userDataPath = getProfileUserDataPath()
): VshuProfileListState {
  const index = loadOrCreateProfileIndex(userDataPath)
  const now = Date.now()
  let found = false
  const profiles = index.profiles.map((profile) => {
    if (profile.id !== profileId) {
      return profile
    }
    found = true
    return {
      ...profile,
      updatedAt: now,
      lastOpenedAt: now
    }
  })
  if (!found) {
    throw new Error('unknown_vshu_profile')
  }
  const nextIndex: VshuProfileIndex = {
    ...index,
    activeProfileId: profileId,
    profiles
  }
  mkdirSync(getVshuProfileDirectory(profileId, userDataPath), { recursive: true })
  // A sign-in still in flight belongs to the profile being left.
  supersedeCloudConnectAttempts()
  writeProfileIndex(getVshuProfileIndexPath(userDataPath), nextIndex)
  return {
    activeProfileId: nextIndex.activeProfileId,
    profiles: nextIndex.profiles
  }
}
