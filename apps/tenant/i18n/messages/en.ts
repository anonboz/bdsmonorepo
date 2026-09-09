// English catalog — the source of truth for the `Messages` shape. Every other
// locale is typed as `Messages`, so a missing/renamed key fails `tsc`.

export type Messages = {
  brand: string;
  role: string;
  signOut: string;
  nav: { home: string; leases: string; bills: string; requests: string; notifications: string };
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
  announcements: {
    title: string;
    empty: string;
    system: string;
  };
  notifications: {
    title: string;
    subtitle: string;
    empty: string;
    unreadCount: string;
    unread: string;
    markAllRead: string;
    bell: string;
    bellUnread: string;
    /** Keyed by NotificationType from @repo/shared. */
    types: { invoice_created: string; lease_created: string; announcement_published: string };
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
    detail: {
      back: string;
      terms: string;
      term: string;
      rent: string;
      deposit: string;
      dueDay: string;
      signed: string;
      notSigned: string;
      condition: string;
      conditionHint: string;
      conditionEmpty: string;
      recordedOn: string;
      noPhotos: string;
      photoAlt: string;
      inspectionTypes: { move_in: string; move_out: string; routine: string; maintenance: string };
      bills: string;
      billsEmpty: string;
      colPeriod: string;
      colDue: string;
      colAmount: string;
      colStatus: string;
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
      readingRange: string;
      readingPhotoAlt: string;
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
  nav: {
    home: "Home",
    leases: "My leases",
    bills: "My bills",
    requests: "Requests",
    notifications: "Notifications",
  },
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
  announcements: {
    title: "Announcements",
    empty: "No announcements right now.",
    system: "System",
  },
  notifications: {
    title: "Notifications",
    subtitle: "Updates about your leases, bills and announcements.",
    empty: "You're all caught up.",
    unreadCount: "{count} unread",
    unread: "Unread",
    markAllRead: "Mark all as read",
    bell: "Notifications",
    bellUnread: "Notifications, {count} unread",
    types: {
      invoice_created: "New bill",
      lease_created: "New lease",
      announcement_published: "Announcement",
    },
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
    detail: {
      back: "Back to leases",
      terms: "Lease terms",
      term: "Term",
      rent: "Monthly rent",
      deposit: "Deposit",
      dueDay: "Rent due on day {day} of each month",
      signed: "Signed {date}",
      notSigned: "Not signed yet",
      condition: "Condition records",
      conditionHint:
        "Photos and notes recorded by your landlord at move-in and move-out. Keep them for reference when you move out.",
      conditionEmpty: "No condition record yet.",
      recordedOn: "Recorded {date}",
      noPhotos: "No photos attached.",
      photoAlt: "Condition photo",
      inspectionTypes: {
        move_in: "Move-in inspection",
        move_out: "Move-out inspection",
        routine: "Routine inspection",
        maintenance: "Maintenance inspection",
      },
      bills: "Bills on this lease",
      billsEmpty: "No bills yet.",
      colPeriod: "Period",
      colDue: "Due",
      colAmount: "Amount",
      colStatus: "Status",
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
      readingRange: "Reading: {prev} → {curr}",
      readingPhotoAlt: "Meter photo",
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
