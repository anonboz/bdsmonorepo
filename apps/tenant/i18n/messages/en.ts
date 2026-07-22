// English catalog — the source of truth for the `Messages` shape. Every other
// locale is typed as `Messages`, so a missing/renamed key fails `tsc`.

export type Messages = {
  brand: string;
  role: string;
  signOut: string;
  nav: { home: string; leases: string; bills: string; requests: string };
  home: {
    welcome: string;
    subtitle: string;
    leasesTitle: string;
    leasesDesc: string;
    leasesCta: string;
    billsTitle: string;
    billsDesc: string;
    billsCta: string;
    requestsTitle: string;
    requestsDesc: string;
    requestsCta: string;
  };
  leases: {
    title: string;
    subtitle: string;
    empty: string;
    colProperty: string;
    colTerm: string;
    colRent: string;
    colStatus: string;
    perMonth: string;
    status: {
      draft: string;
      active: string;
      ended: string;
      terminated: string;
      renewed: string;
    };
  };
  bills: {
    title: string;
    subtitle: string;
    outstanding: string;
    empty: string;
    colProperty: string;
    colPeriod: string;
    colDue: string;
    colAmount: string;
    colStatus: string;
    status: {
      draft: string;
      open: string;
      partially_paid: string;
      paid: string;
      overdue: string;
      void: string;
    };
    detail: {
      back: string;
      title: string;
      period: string;
      summary: string;
      colAmount: string;
      colPaid: string;
      colOutstanding: string;
      colDue: string;
      colStatus: string;
      colProperty: string;
      chargesTitle: string;
      colItem: string;
      colConsumption: string;
      total: string;
      lineKinds: { rent: string; water: string; electricity: string; other: string };
      paymentsTitle: string;
      noPayments: string;
      pDate: string;
      pMethod: string;
      pStatus: string;
      pAmount: string;
      pRef: string;
      methods: { card: string; bank_transfer: string; ach: string; cash: string; other: string };
      paymentStatus: {
        pending: string;
        succeeded: string;
        failed: string;
        refunded: string;
      };
    };
  };
  tickets: {
    title: string;
    subtitle: string;
    openCount: string;
    empty: string;
    colRequest: string;
    colProperty: string;
    colPriority: string;
    colStatus: string;
    colReported: string;
    assigned: string;
    status: {
      open: string;
      triaged: string;
      assigned: string;
      in_progress: string;
      completed: string;
      cancelled: string;
    };
    priority: {
      low: string;
      medium: string;
      high: string;
      emergency: string;
    };
  };
  login: {
    title: string;
    description: string;
    email: string;
    password: string;
    signIn: string;
    signingIn: string;
    error: string;
  };
  language: { label: string };
};

const en: Messages = {
  brand: "Tenant",
  role: "Tenant",
  signOut: "Sign out",
  nav: { home: "Home", leases: "My leases", bills: "My bills", requests: "Requests" },
  home: {
    welcome: "Welcome, {name}",
    subtitle: "Everything about your rental in one place.",
    leasesTitle: "My leases",
    leasesDesc: "You are on {count} lease(s). Review terms, rent and status.",
    leasesCta: "View my leases",
    billsTitle: "My bills",
    billsDesc: "Track rent invoices and payment history.",
    billsCta: "View my bills",
    requestsTitle: "Requests",
    requestsDesc: "Raise and follow up on maintenance requests.",
    requestsCta: "View requests",
  },
  leases: {
    title: "My leases",
    subtitle: "You are on {count} lease(s).",
    empty: "You're not on any leases yet.",
    colProperty: "Property",
    colTerm: "Term",
    colRent: "Rent",
    colStatus: "Status",
    perMonth: "{amount}/mo",
    status: {
      draft: "Draft",
      active: "Active",
      ended: "Ended",
      terminated: "Terminated",
      renewed: "Renewed",
    },
  },
  bills: {
    title: "My bills",
    subtitle: "Rent invoices across your leases.",
    outstanding: "Outstanding balance: {amount}",
    empty: "You have no bills yet.",
    colProperty: "Property",
    colPeriod: "Period",
    colDue: "Due",
    colAmount: "Amount",
    colStatus: "Status",
    status: {
      draft: "Draft",
      open: "Open",
      partially_paid: "Partially paid",
      paid: "Paid",
      overdue: "Overdue",
      void: "Void",
    },
    detail: {
      back: "Back to bills",
      title: "Rent invoice",
      period: "{start} – {end}",
      summary: "Summary",
      colAmount: "Amount",
      colPaid: "Paid",
      colOutstanding: "Outstanding",
      colDue: "Due date",
      colStatus: "Status",
      colProperty: "Property",
      chargesTitle: "Charges",
      colItem: "Item",
      colConsumption: "Consumption",
      total: "Total",
      lineKinds: {
        rent: "Rent",
        water: "Water",
        electricity: "Electricity",
        other: "Other",
      },
      paymentsTitle: "Payments",
      noPayments: "No payments recorded yet.",
      pDate: "Date",
      pMethod: "Method",
      pStatus: "Status",
      pAmount: "Amount",
      pRef: "Reference",
      methods: {
        card: "Card",
        bank_transfer: "Bank transfer",
        ach: "ACH",
        cash: "Cash",
        other: "Other",
      },
      paymentStatus: {
        pending: "Pending",
        succeeded: "Succeeded",
        failed: "Failed",
        refunded: "Refunded",
      },
    },
  },
  tickets: {
    title: "Requests",
    subtitle: "Maintenance requests you've raised.",
    openCount: "{count} open",
    empty: "You haven't raised any requests yet.",
    colRequest: "Request",
    colProperty: "Property",
    colPriority: "Priority",
    colStatus: "Status",
    colReported: "Reported",
    assigned: "{vendor} · {date}",
    status: {
      open: "Open",
      triaged: "Triaged",
      assigned: "Assigned",
      in_progress: "In progress",
      completed: "Completed",
      cancelled: "Cancelled",
    },
    priority: {
      low: "Low",
      medium: "Medium",
      high: "High",
      emergency: "Emergency",
    },
  },
  login: {
    title: "Tenant sign in",
    description: "View your leases, bills and requests.",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    signingIn: "Signing in…",
    error: "Invalid email or password.",
  },
  language: { label: "Language" },
};

export default en;
