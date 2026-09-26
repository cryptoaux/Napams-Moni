const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeCompanies,
  summarizeCompanies,
  buildVisibleCompanies
} = require("../src/reporting-helpers");

test("normalizeCompanies accepts the current dashboard company list shape", () => {
  const companies = normalizeCompanies({
    companies: [
      {
        name: "ABC Ltd",
        applications: [
          {
            product: "Panel License",
            currentStatus: "Approved",
            currentStatusColor: "GREEN"
          }
        ]
      }
    ]
  });

  assert.equal(companies.length, 1);
  assert.equal(companies[0].name, "ABC Ltd");
  assert.equal(companies[0].applications.length, 1);
});

test("summarizeCompanies counts totals without hardcoded values", () => {
  const summary = summarizeCompanies([
    {
      applications: [
        { currentStatus: "Approved" },
        { currentStatus: "In Progress" },
        { currentStatus: "Submitted" }
      ]
    },
    {
      applications: [{ currentStatus: "Approved" }]
    }
  ]);

  assert.deepEqual(summary, {
    totalCompanies: 2,
    totalApplications: 4,
    approved: 2,
    inProgress: 2
  });
});

test("buildVisibleCompanies applies the active search query to current dashboard data", () => {
  const companies = [
    {
      name: "Alpha",
      applications: [{ product: "Grant Management" }, { product: "Payroll" }]
    },
    {
      name: "Beta",
      applications: [{ product: "Training Provision" }]
    }
  ];

  assert.deepEqual(buildVisibleCompanies(companies, "pay"), [
    {
      name: "Alpha",
      applications: [{ product: "Payroll" }]
    }
  ]);
});
