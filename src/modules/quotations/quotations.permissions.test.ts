import { describe, expect, it } from "vitest"
import type { QuotationStatus } from "#generated/prisma/client.js"
import { permissionsForChange } from "./quotations.permissions.js"

const state = (status: QuotationStatus, isDeleted = false) => ({ status, isDeleted })
const statusChange = (from: QuotationStatus, to: QuotationStatus) => permissionsForChange(state(from), state(to), false)

describe("permissionsForChange", () => {
  it("needs nothing for a change that changes nothing", () => {
    expect(statusChange("active", "active")).toEqual([])
    expect(statusChange("cancelledAfterPayment", "cancelledAfterPayment")).toEqual([])
  })

  it("needs EDIT for details or lines", () => {
    expect(permissionsForChange(state("active"), state("active"), true)).toEqual(["QUOTATIONS.EDIT"])
  })

  it("needs DELETE to delete and RESTORE to restore", () => {
    expect(permissionsForChange(state("active"), state("active", true), false)).toEqual(["QUOTATIONS.DELETE"])
    expect(permissionsForChange(state("active", true), state("active"), false)).toEqual(["QUOTATIONS.RESTORE"])
  })

  it("needs the matching key to confirm", () => {
    expect(statusChange("active", "paymentConfirmed")).toEqual(["QUOTATIONS.CONFIRM_PAYMENT"])
    expect(statusChange("active", "creditConfirmed")).toEqual(["QUOTATIONS.CONFIRM_CREDIT"])
  })

  it("needs UNDO_CONFIRMATION to leave a confirmed status other than by cancelling", () => {
    expect(statusChange("paymentConfirmed", "active")).toEqual(["QUOTATIONS.UNDO_CONFIRMATION"])
    expect(statusChange("paymentConfirmed", "creditConfirmed")).toEqual(["QUOTATIONS.UNDO_CONFIRMATION", "QUOTATIONS.CONFIRM_CREDIT"])
  })

  it("needs only CANCEL to cancel, confirmed or not", () => {
    expect(statusChange("active", "cancelled")).toEqual(["QUOTATIONS.CANCEL"])
    expect(statusChange("creditConfirmed", "cancelledAfterCredit")).toEqual(["QUOTATIONS.CANCEL"])
  })

  it("needs REOPEN to reopen, and UNDO_CONFIRMATION too when it was confirmed before cancelling", () => {
    expect(statusChange("cancelled", "active")).toEqual(["QUOTATIONS.REOPEN"])
    expect(statusChange("cancelledAfterPayment", "active")).toEqual(["QUOTATIONS.REOPEN", "QUOTATIONS.UNDO_CONFIRMATION"])
    expect(statusChange("cancelled", "paymentConfirmed")).toEqual(["QUOTATIONS.REOPEN", "QUOTATIONS.CONFIRM_PAYMENT"])
  })
})
