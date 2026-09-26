const reportingHelpers = (() => {
  function normalizeCompanies(data) {
    if (data && Array.isArray(data.companies)) {
      return data.companies;
    }

    const applications = Array.isArray(data)
      ? data
      : data && Array.isArray(data.applications)
        ? data.applications
        : [];

    const groups = {};
    applications.forEach((app) => {
      const company = app.companyName || app.company || "Unknown Company";
      if (!groups[company]) {
        groups[company] = [];
      }
      groups[company].push(app);
    });

    return Object.keys(groups).map((name) => ({
      name,
      applications: groups[name]
    }));
  }

  function summarizeCompanies(companies) {
    const totalCompanies = companies.length;
    let totalApplications = 0;
    let approved = 0;
    let inProgress = 0;

    companies.forEach((company) => {
      const applications = Array.isArray(company.applications)
        ? company.applications
        : [];

      totalApplications += applications.length;

      applications.forEach((app) => {
        const status = String(app.currentStatus || "").toLowerCase();
        if (status.includes("approved")) {
          approved += 1;
        } else {
          inProgress += 1;
        }
      });
    });

    return {
      totalCompanies,
      totalApplications,
      approved,
      inProgress
    };
  }

  function buildVisibleCompanies(companies, queryValue) {
    const normalizedQuery = String(queryValue || "").trim().toLowerCase();

    if (!normalizedQuery) {
      return companies;
    }

    return companies
      .map((company) => {
        const applications = Array.isArray(company.applications)
          ? company.applications
          : [];

        const matches = applications.filter((app) => {
          const product = String(app.product || app.name || "").toLowerCase();
          return product.includes(normalizedQuery);
        });

        if (matches.length === 0) {
          return null;
        }

        return {
          ...company,
          applications: matches
        };
      })
      .filter(Boolean);
  }

  return {
    normalizeCompanies,
    summarizeCompanies,
    buildVisibleCompanies
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = reportingHelpers;
}

if (typeof globalThis !== "undefined") {
  globalThis.reportingHelpers = reportingHelpers;
}
