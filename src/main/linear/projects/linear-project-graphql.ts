// Why: agent listings read every page, so they skip the heavy fields they never return.
const VSHU_PROJECT_SUMMARY_FIELDS = `
  id
  slugId
  name
  url
  color
  icon
  updatedAt
  status {
    id
    name
    type
    color
  }
  teams(first: 10) {
    nodes {
      id
      name
      key
    }
  }
`

const VSHU_PROJECT_EXTRA_FIELDS = `
  description
  content
  health
  priority
  priorityLabel
  progress
  scope
  issueCountHistory
  completedIssueCountHistory
  startDate
  targetDate
  createdAt
  completedAt
  canceledAt
  startedAt
  lead {
    id
    displayName
    avatarUrl
  }
  members(first: 10) {
    nodes {
      id
      displayName
      avatarUrl
    }
  }
  labels(first: 20) {
    nodes {
      id
      name
      color
    }
  }
`

export const VSHU_PROJECT_FIELDS = `
  ${VSHU_PROJECT_SUMMARY_FIELDS}
  ${VSHU_PROJECT_EXTRA_FIELDS}
`

const VSHU_PROJECT_LIST_FIELDS = `
  ${VSHU_PROJECT_SUMMARY_FIELDS}
  ... @include(if: $detail) {
    ${VSHU_PROJECT_EXTRA_FIELDS}
  }
`

export const VSHU_PROJECT_DETAIL_FIELDS = `
  ${VSHU_PROJECT_FIELDS}
  projectMilestones(first: 20) {
    nodes {
      id
      name
      status
      targetDate
      progress
    }
  }
  externalLinks(first: 20) {
    nodes {
      id
      label
      url
    }
  }
  lastUpdate {
    id
    body
    health
    url
    createdAt
    updatedAt
    user {
      id
      displayName
      avatarUrl
    }
  }
`

export const VSHU_ISSUE_FIELDS = `
  id
  identifier
  title
  branchName
  description
  url
  priority
  estimate
  updatedAt
  labelIds
  state {
    name
    type
    color
  }
  team {
    id
    name
    key
  }
  assignee {
    id
    displayName
    avatarUrl
  }
  labels(first: 50) {
    nodes {
      id
      name
    }
  }
`

export const PROJECTS_QUERY = `
  query VshuLinearProjects(
    $first: Int
    $after: String
    $filter: ProjectFilter
    $orderBy: PaginationOrderBy
    $detail: Boolean = true
  ) {
    projects(first: $first, after: $after, filter: $filter, orderBy: $orderBy) {
      nodes {
        ${VSHU_PROJECT_LIST_FIELDS}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

export const SEARCH_PROJECTS_QUERY = `
  query VshuLinearProjectSearch(
    $term: String!
    $first: Int
    $after: String
    $detail: Boolean = true
  ) {
    searchProjects(term: $term, first: $first, after: $after) {
      nodes {
        ${VSHU_PROJECT_LIST_FIELDS}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

export const PROJECT_QUERY = `
  query VshuLinearProject($id: String!) {
    project(id: $id) {
      ${VSHU_PROJECT_DETAIL_FIELDS}
    }
  }
`

export const CREATE_PROJECT_MUTATION = `
  mutation VshuLinearProjectCreate($input: ProjectCreateInput!) {
    projectCreate(input: $input) {
      success
      project {
        ${VSHU_PROJECT_DETAIL_FIELDS}
      }
    }
  }
`

export const PROJECT_ISSUES_QUERY = `
  query VshuLinearProjectIssues(
    $id: String!,
    $first: Int,
    $after: String,
    $orderBy: PaginationOrderBy
  ) {
    project(id: $id) {
      issues(first: $first, after: $after, orderBy: $orderBy) {
        nodes {
          ${VSHU_ISSUE_FIELDS}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`

export const PROJECT_TEAMS_QUERY = `
  query VshuLinearProjectTeams($id: String!, $first: Int, $after: String) {
    project(id: $id) {
      teams(first: $first, after: $after) {
        nodes {
          id
          name
          key
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`
