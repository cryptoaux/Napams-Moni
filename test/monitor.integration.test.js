const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const https = require("https");

const monitor = require("../monitor");
const { companiesSchema } = require("../src/schemas");

const fixtureRoot = path.join(process.cwd(), "test", "fixtures");
const loginPageFixture = fs.readFileSync(
  path.join(fixtureRoot, "login-page.html"),
  "utf8"
);
const applicationsPageFixture = fs.readFileSync(
  path.join(fixtureRoot, "applications-page.html"),
  "utf8"
);

function buildStatusPayload(overrides = {}) {
  return {
    statusProductName: "Sample Product",
    trackingAppStageVMs: [
      {
        trackingStageName: "Submitted",
        description: "bg-primary",
        duration: "1d",
        currentStageSet: false
      },
      {
        trackingStageName: "Final Review",
        description: "bg-warning",
        duration: "2d",
        currentStageSet: true
      },
      ...(overrides.trackingAppStageVMs || []).map((stage) => stage)
    ],
    ...overrides
  };
}

function buildMockRequest(responseSequence) {
  let callIndex = 0;

  const requestStub = test.mock.method(
    https,
    "request",
    (options, callback) => {
      const response = responseSequence[callIndex++];

      if (!response) {
        throw new Error("Unexpected HTTPS request beyond the mocked sequence.");
      }

      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = response.status;
        res.httpVersion = "1.1";
        res.headers = response.headers || {};
        res.setEncoding = () => {};

        process.nextTick(() => {
          callback(res);

          if (response.body) {
            res.emit("data", response.body);
          }

          res.emit("end");
        });
      };
      req.destroy = () => {};

      return req;
    }
  );

  return {
    requestStub,
    getCallCount() {
      return callIndex;
    }
  };
}

function withFakeCredentials(companyCount = 2) {
  process.env.TEST_COMPANY_1_TIN = "TIN-100-1";
  process.env.TEST_COMPANY_1_PASSWORD = "Password-123";

  if (companyCount > 1) {
    process.env.TEST_COMPANY_2_TIN = "TIN-200-2";
    process.env.TEST_COMPANY_2_PASSWORD = "Password-456";
  }
}

function clearFakeCredentials() {
  delete process.env.TEST_COMPANY_1_TIN;
  delete process.env.TEST_COMPANY_1_PASSWORD;
  delete process.env.TEST_COMPANY_2_TIN;
  delete process.env.TEST_COMPANY_2_PASSWORD;
}

function writeSingleCompanyFixture(dirPath) {
  const companiesFile = path.join(dirPath, "companies.json");
  const companies = [
    {
      id: "company_01",
      name: "Retry Company",
      tinSecret: "TEST_COMPANY_1_TIN",
      passwordSecret: "TEST_COMPANY_1_PASSWORD"
    }
  ];

  fs.writeFileSync(companiesFile, JSON.stringify(companies, null, 2), "utf8");

  return companiesFile;
}

function writeCompaniesFixture(dirPath, companies) {
  const companiesFile = path.join(dirPath, "companies.json");

  fs.writeFileSync(companiesFile, JSON.stringify(companies, null, 2), "utf8");

  return companiesFile;
}

test("monitor.loadCompanies rejects missing files and invalid company config", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napams-monitor-"));

  try {
    assert.throws(
      () => monitor.loadCompanies(path.join(tmpDir, "missing-companies.json")),
      /Missing/
    );

    const badConfigPath = path.join(tmpDir, "bad-companies.json");
    fs.writeFileSync(badConfigPath, JSON.stringify({ bad: true }), "utf8");

    assert.throws(
      () => monitor.loadCompanies(badConfigPath),
      /must contain a companies array/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("monitor.main skips companies whose credentials are missing and writes an empty aggregate", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napams-monitor-"));
  const companiesFile = writeCompaniesFixture(tmpDir, [
    {
      id: "company_01",
      name: "Missing Secret Company",
      tinSecret: "TEST_COMPANY_1_TIN",
      passwordSecret: "TEST_COMPANY_1_PASSWORD"
    }
  ]);
  const outputPath = path.join(tmpDir, "data.json");

  process.env.TEST_COMPANY_1_TIN = "TIN-100-1";
  delete process.env.TEST_COMPANY_1_PASSWORD;

  try {
    await monitor.main({ companiesFile, outputPath });

    const payload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(payload.totalCompanies, 0);
    assert.equal(payload.totalApplications, 0);
    assert.deepEqual(payload.companies, []);
    assert.deepEqual(payload.applications, []);
  } finally {
    clearFakeCredentials();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("monitor.main accepts individual company secret env vars without COMPANIES_CREDENTIALS_JSON", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napams-monitor-"));
  const companiesFile = writeCompaniesFixture(tmpDir, [
    {
      id: "company_01",
      name: "Structured Secret Company",
      tinSecret: "TEST_COMPANY_1_TIN",
      passwordSecret: "TEST_COMPANY_1_PASSWORD"
    }
  ]);
  const outputPath = path.join(tmpDir, "data.json");

  delete process.env.COMPANIES_CREDENTIALS_JSON;
  process.env.TEST_COMPANY_1_TIN = "TIN-ENV-1";
  process.env.TEST_COMPANY_1_PASSWORD = "Password-ENV-1";

  const responseSequence = [
    {
      status: 200,
      headers: {
        "set-cookie": [
          ".AspNetCore.Antiforgery=login-cookie-1; path=/; secure",
          "NAPAMS.Session=seed-session-1; path=/; HttpOnly"
        ]
      },
      body: loginPageFixture
    },
    {
      status: 302,
      headers: {
        "set-cookie": [
          ".AspNetCore.Antiforgery=session-cookie-1; path=/; secure",
          "NAPAMS.Auth=auth-token-1; path=/; secure"
        ]
      },
      body: ""
    },
    {
      status: 200,
      headers: {},
      body: applicationsPageFixture
    },
    {
      status: 200,
      headers: {},
      body: JSON.stringify(
        buildStatusPayload({
          statusProductName: "Structured Product",
          trackingAppStageVMs: [
            {
              trackingStageName: "Submitted",
              description: "bg-primary",
              duration: "1d",
              currentStageSet: false
            },
            {
              trackingStageName: "Final Review",
              description: "bg-warning",
              duration: "2d",
              currentStageSet: true
            }
          ]
        })
      )
    }
  ];

  const requestStub = buildMockRequest(responseSequence);

  try {
    await monitor.main({ companiesFile, outputPath });

    const payload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(payload.totalCompanies, 1);
    assert.equal(payload.totalApplications, 1);
    assert.equal(payload.companies[0].name, "Structured Secret Company");
    assert.equal(payload.applications[0].applicationNumber, "NF-AA-2024");
    assert.equal(payload.applications[0].currentStatus, "Final Review");
  } finally {
    requestStub.requestStub.mock.restore();
    delete process.env.COMPANIES_CREDENTIALS_JSON;
    clearFakeCredentials();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("monitor.main continues when a company processing error occurs", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napams-monitor-"));
  const companiesFile = writeSingleCompanyFixture(tmpDir);
  const outputPath = path.join(tmpDir, "data.json");

  withFakeCredentials(1);

  const requestStub = test.mock.method(
    https,
    "request",
    (options, callback) => {
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 500;
        res.httpVersion = "1.1";
        res.headers = {};
        res.setEncoding = () => {};

        process.nextTick(() => {
          callback(res);
          res.emit("data", "Login unavailable");
          res.emit("end");
        });
      };
      req.destroy = () => {};

      return req;
    }
  );

  try {
    await monitor.main({ companiesFile, outputPath });

    const payload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(payload.totalCompanies, 0);
    assert.equal(payload.totalApplications, 0);
    assert.deepEqual(payload.companies, []);
  } finally {
    requestStub.mock.restore();
    clearFakeCredentials();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("synthetic companies sample fixture is valid for offline monitor smoke tests", () => {
  const sampleConfigPath = path.join(fixtureRoot, "companies.sample.json");
  const source = fs.readFileSync(sampleConfigPath, "utf8");
  const parsed = JSON.parse(source);
  const result = companiesSchema.safeParse(parsed);

  assert.equal(result.success, true);
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, "Sample Company One");
  assert.equal(parsed[1].name, "Sample Company Two");
  assert.ok(
    !/AKIA[0-9A-Z]{16}|BEGIN (RSA|EC|DSA|OPENSSH) PRIVATE KEY|gh[pousr]_|xox[baprs]-|AIza[0-9A-Za-z_-]{35}/.test(
      source
    )
  );
});

test("monitor.main runs the orchestrated monitoring flow with mocked HTTPS responses", async () => {
  const companiesFile = path.join(fixtureRoot, "companies.sample.json");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napams-monitor-"));
  const outputPath = path.join(tmpDir, "data.json");

  withFakeCredentials();

  const responseSequence = [
    {
      status: 200,
      headers: {
        "set-cookie": [
          ".AspNetCore.Antiforgery=login-cookie-1; path=/; secure",
          "NAPAMS.Session=seed-session-1; path=/; HttpOnly"
        ]
      },
      body: loginPageFixture
    },
    {
      status: 302,
      headers: {
        "set-cookie": [
          ".AspNetCore.Antiforgery=session-cookie-1; path=/; secure",
          "NAPAMS.Auth=auth-token-1; path=/; secure"
        ]
      },
      body: ""
    },
    {
      status: 200,
      headers: {},
      body: applicationsPageFixture
    },
    {
      status: 200,
      headers: {},
      body: JSON.stringify(
        buildStatusPayload({
          trackingAppStageVMs: [
            {
              trackingStageName: "Submitted",
              description: "bg-primary",
              duration: "1d"
            },
            {
              trackingStageName: "Final Review",
              description: "bg-warning",
              duration: "2d",
              currentStageSet: true
            }
          ]
        })
      )
    },
    {
      status: 200,
      headers: {},
      body: JSON.stringify(
        buildStatusPayload({
          trackingAppStageVMs: [
            {
              trackingStageName: "Submitted",
              description: "bg-primary",
              duration: "1d"
            },
            {
              trackingStageName: "Final Review",
              description: "bg-warning",
              duration: "2d",
              currentStageSet: true
            }
          ]
        })
      )
    },
    {
      status: 200,
      headers: {
        "set-cookie": [
          ".AspNetCore.Antiforgery=login-cookie-2; path=/; secure",
          "NAPAMS.Session=seed-session-2; path=/; HttpOnly"
        ]
      },
      body: loginPageFixture
    },
    {
      status: 302,
      headers: {
        "set-cookie": [
          ".AspNetCore.Antiforgery=session-cookie-2; path=/; secure",
          "NAPAMS.Auth=auth-token-2; path=/; secure"
        ]
      },
      body: ""
    },
    {
      status: 200,
      headers: {},
      body: applicationsPageFixture
    },
    {
      status: 200,
      headers: {},
      body: JSON.stringify(
        buildStatusPayload({
          trackingAppStageVMs: [
            {
              trackingStageName: "Submitted",
              description: "bg-primary",
              duration: "1d"
            },
            {
              trackingStageName: "Final Review",
              description: "bg-warning",
              duration: "2d",
              currentStageSet: true
            }
          ]
        })
      )
    },
    {
      status: 200,
      headers: {},
      body: JSON.stringify(
        buildStatusPayload({
          trackingAppStageVMs: [
            {
              trackingStageName: "Submitted",
              description: "bg-primary",
              duration: "1d"
            },
            {
              trackingStageName: "Final Review",
              description: "bg-warning",
              duration: "2d",
              currentStageSet: true
            }
          ]
        })
      )
    }
  ];

  const { requestStub, getCallCount } = buildMockRequest(responseSequence);

  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => {
    fn();
    return 0;
  };

  try {
    await monitor.main({ companiesFile, outputPath });

    assert.equal(getCallCount(), 10, "all mocked requests should be consumed");

    const payload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(payload.totalCompanies, 2);
    assert.equal(payload.totalApplications, 4);
    assert.equal(payload.companies[0].applications.length, 2);
    assert.equal(payload.applications[0].applicationNumber, "NF-AA-2024");
    assert.equal(payload.applications[0].currentStatus, "Final Review");
    assert.match(payload.updatedAt, /T.*Z$/);
    assert.equal(fs.existsSync(outputPath), true);
  } finally {
    global.setTimeout = originalSetTimeout;
    requestStub.mock.restore();
    clearFakeCredentials();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("monitor.main retries login when NAPAMS returns HTTP 400 before succeeding", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napams-monitor-"));
  const companiesFile = writeSingleCompanyFixture(tmpDir);
  const outputPath = path.join(tmpDir, "data.json");

  withFakeCredentials(1);

  const responseSequence = [
    {
      status: 200,
      headers: {
        "set-cookie": [
          ".AspNetCore.Antiforgery=first-login-cookie; path=/; secure",
          "NAPAMS.Session=retry-session; path=/; HttpOnly"
        ]
      },
      body: loginPageFixture
    },
    {
      status: 400,
      headers: {},
      body: "Bad Request"
    },
    {
      status: 200,
      headers: {
        "set-cookie": [
          ".AspNetCore.Antiforgery=retry-login-cookie; path=/; secure",
          "NAPAMS.Session=retry-session-2; path=/; HttpOnly"
        ]
      },
      body: loginPageFixture
    },
    {
      status: 302,
      headers: {
        "set-cookie": [
          ".AspNetCore.Antiforgery=session-cookie-retry; path=/; secure",
          "NAPAMS.Auth=auth-token-retry; path=/; secure"
        ]
      },
      body: ""
    },
    {
      status: 200,
      headers: {},
      body: applicationsPageFixture
    },
    {
      status: 200,
      headers: {},
      body: JSON.stringify(
        buildStatusPayload({
          trackingAppStageVMs: [
            {
              trackingStageName: "Submitted",
              description: "bg-primary",
              duration: "1d"
            },
            {
              trackingStageName: "Final Review",
              description: "bg-warning",
              duration: "2d",
              currentStageSet: true
            }
          ]
        })
      )
    },
    {
      status: 200,
      headers: {},
      body: JSON.stringify(
        buildStatusPayload({
          trackingAppStageVMs: [
            {
              trackingStageName: "Submitted",
              description: "bg-primary",
              duration: "1d"
            },
            {
              trackingStageName: "Final Review",
              description: "bg-warning",
              duration: "2d",
              currentStageSet: true
            }
          ]
        })
      )
    }
  ];

  const { requestStub, getCallCount } = buildMockRequest(responseSequence);

  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => {
    fn();
    return 0;
  };

  try {
    await monitor.main({ companiesFile, outputPath });

    assert.equal(
      getCallCount(),
      7,
      "HTTP 400 retry should complete with a second successful login"
    );
    const payload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(payload.totalApplications, 2);
  } finally {
    global.setTimeout = originalSetTimeout;
    requestStub.mock.restore();
    clearFakeCredentials();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("monitor.main retries when the login page is missing the antiforgery token", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "napams-monitor-"));
  const companiesFile = writeSingleCompanyFixture(tmpDir);
  const outputPath = path.join(tmpDir, "data.json");

  withFakeCredentials(1);

  const responseSequence = [
    {
      status: 200,
      headers: {
        "set-cookie": [
          ".AspNetCore.Antiforgery=stale-cookie; path=/; secure",
          "NAPAMS.Session=stale-session; path=/; HttpOnly"
        ]
      },
      body: "<form><input type='text' name='Username' /></form>"
    },
    {
      status: 200,
      headers: {
        "set-cookie": [
          ".AspNetCore.Antiforgery=recovered-cookie; path=/; secure",
          "NAPAMS.Session=recovered-session; path=/; HttpOnly"
        ]
      },
      body: loginPageFixture
    },
    {
      status: 302,
      headers: {
        "set-cookie": [
          ".AspNetCore.Antiforgery=session-cookie-recovered; path=/; secure",
          "NAPAMS.Auth=auth-token-recovered; path=/; secure"
        ]
      },
      body: ""
    },
    {
      status: 200,
      headers: {},
      body: applicationsPageFixture
    },
    {
      status: 200,
      headers: {},
      body: JSON.stringify(
        buildStatusPayload({
          trackingAppStageVMs: [
            {
              trackingStageName: "Submitted",
              description: "bg-primary",
              duration: "1d"
            },
            {
              trackingStageName: "Final Review",
              description: "bg-warning",
              duration: "2d",
              currentStageSet: true
            }
          ]
        })
      )
    },
    {
      status: 200,
      headers: {},
      body: JSON.stringify(
        buildStatusPayload({
          trackingAppStageVMs: [
            {
              trackingStageName: "Submitted",
              description: "bg-primary",
              duration: "1d"
            },
            {
              trackingStageName: "Final Review",
              description: "bg-warning",
              duration: "2d",
              currentStageSet: true
            }
          ]
        })
      )
    }
  ];

  const { requestStub, getCallCount } = buildMockRequest(responseSequence);

  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => {
    fn();
    return 0;
  };

  try {
    await monitor.main({ companiesFile, outputPath });

    assert.equal(
      getCallCount(),
      6,
      "missing-token refresh should recover and continue to status checks"
    );
    const payload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(payload.totalApplications, 2);
    assert.equal(payload.applications[0].currentStatus, "Final Review");
  } finally {
    global.setTimeout = originalSetTimeout;
    requestStub.mock.restore();
    clearFakeCredentials();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
