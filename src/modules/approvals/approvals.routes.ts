import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod"
import { actorOf } from "#security/auth.plugin.js"
import { approvalRule, approvalRuleList, approvalScreenParams, updateApprovalRuleBody } from "./approvals.schema.js"
import { listApprovalRules, updateApprovalRule } from "./approvals.service.js"

// The rules, for the admin screen. Approving and rejecting are routes of each screen (e.g. POST
// /internal-requisitions/:id/approve), under that screen's own APPROVE and REJECT permissions.
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/rules",
    {
      schema: { response: { 200: approvalRuleList } },
      config: { permission: "APPROVALS.VIEW", cache: ["ApprovalRule"] },
    },
    () => listApprovalRules(),
  )

  app.patch(
    "/rules/:screen",
    {
      schema: { params: approvalScreenParams, body: updateApprovalRuleBody, response: { 200: approvalRule } },
      config: { permission: "APPROVALS.EDIT" },
    },
    (req) => updateApprovalRule(req.params.screen, req.body, actorOf(req)),
  )
}

export default routes
