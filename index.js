const core = require('@actions/core')
const github = require('@actions/github')
const util = require('util')

const organization = github.context.payload.organization.login
const private_repo = core.getInput('private_repo')
const public_repo = core.getInput('public_repo')
const bot_username = core.getInput('bot_username')
const public_assignee = core.getInput('public_assignee')
const octokit = github.getOctokit(core.getInput('bot_access_token'))

async function run() {
  const payload = github.context.payload
  
  try {
    const botComment = await getExistingBotComment(payload.issue)
    const publicIssueNumber = getExistingLinkedPublicIssueNumber(botComment)
    
    if (payload.action === "labeled" && payload.label.name === "public" && !payload.issue.closed_at) {
      if (!publicIssueNumber) {
        await createLinkedPublicIssue(payload.issue)
      } else {
        core.setFailed("Existing linked issue number already exists: " + publicIssueNumber)
      }
    } else if (payload.action === "unlabeled" && payload.label.name === "public") {
      if (publicIssueNumber) {
        await deleteLinkedPublicIssue(botComment, publicIssueNumber)
      } else {
        core.setFailed("No linked issue number found")
      }
    } else if (payload.issue.labels.find(label => label.name === "public")) {
      if (payload.action === "edited" || payload.action === "labeled" || payload.action === "unlabeled" || payload.action === "closed" || payload.action === "reopened") {
        await updateLinkedPublicIssue(payload.issue, publicIssueNumber)
      } else if (payload.action === "deleted") {
        await deleteLinkedPublicIssue(botComment, publicIssueNumber)
      }
    }
  } catch (error) {
    console.log(error)
    core.setFailed(error.message)
  }
}

async function getExistingBotComment(issue) {
  const existingComments = await octokit.issues.listComments({ 
    owner: organization, 
    repo: private_repo, 
    issue_number: issue.number
  })
  return existingComments.data.find(comment => comment.user.login === bot_username)
}

function getExistingLinkedPublicIssueNumber(botComment) {
  let existingLinkedIssueNumber
  if (botComment && botComment.body.startsWith("linked:")) {
    const commentComponents = botComment.body.split("#")
    if (commentComponents.length) {
      existingLinkedIssueNumber = commentComponents[commentComponents.length - 1]
    }
  }
  return existingLinkedIssueNumber
}

async function createLinkedPublicIssue(issue) {
  const labels = issue.labels
  .map(label => label.name)
  .filter(name => name !== "public" )
  
  // Create the issue copy
  const issueCreation = await octokit.issues.create({
    owner: organization,
    repo: public_repo,
    title: issue.title,
    body: issue.body,
    assignees: [public_assignee],
    labels: labels
  })
  
  // Leave a comment with a link to the public repository
  const comment = await octokit.issues.createComment({
    owner: organization,
    repo: private_repo,
    issue_number: issue.number,
    body: "linked: " + organization + "/" + public_repo + "#" + issueCreation.data.number,
  })
}

async function updateLinkedPublicIssue(issue, publicIssueNumber) {
  const publicIssueGet = await octokit.issues.get({
    owner: organization,
    repo: public_repo,
    issue_number: publicIssueNumber
  })
  const publicIssue = publicIssueGet.data
  
  if (issue.state === "closed" && publicIssue.state === "open") {
    await octokit.issues.createComment({
      owner: organization,
      repo: public_repo,
      issue_number: publicIssueNumber,
      body: "Closing – look for this in the next release! 😃"
    })
  }
    
  const labels = issue.labels
  .map(label => label.name)
  .filter(name => name !== "public" )
  
  if ((issue.title != publicIssue.title) || (issue.body != publicIssue.body) || (labels != publicIssue.labels)) {
    const issueUpdate = await octokit.issues.update({
      owner: organization,
      repo: public_repo,
      issue_number: publicIssueNumber,
      state: issue.state,
      title: issue.title,
      body: issue.body,
      assignees: [public_assignee],
      labels: labels
    })
  }
}

async function deleteLinkedPublicIssue(privateBotComment, publicIssueNumber) {
  // Delete the linked issue
  if (publicIssueNumber) {
    const issueGet = await octokit.graphql(
      `
      query {
        repository(owner:"${organization}", name:"${public_repo}") {
          issue(number:${publicIssueNumber}) {
            id
          }
        }
      }
      `
    )
    const issueId = issueGet.repository.issue.id
    const issueDeletion = await octokit.graphql(
      `
      mutation {
        deleteIssue(input:{issueId: "${issueId}"}) {
          repository {
            id
          }
        }
      }
      `
    )
  }
  
  // Delete the bot comment with the link
  if (privateBotComment) {
    const commentDeletion = await octokit.issues.deleteComment({
      owner: organization,
      repo: private_repo,
      comment_id: privateBotComment.id
    })
  }
}

run()
