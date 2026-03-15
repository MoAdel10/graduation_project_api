const connection = require("../DB");
const crypto = require("crypto");

const runRentalPulse = (req, res) => {
  const notifier = req.app.get("notifier");

  // --- TASK 1: COMPLETED LEASES (Cleanup) ---
  const expiredSql = `
    SELECT l.lease_id, l.renter_id, l.owner_id, p.property_name 
    FROM Lease l
    JOIN Property p ON l.property_id = p.property_id
    WHERE l.check_out_date < CURDATE() AND l.status = 'IN_PROGRESS'
  `;

  connection.query(expiredSql, (err, expiredLeases) => {
    if (err) console.error("❌ Pulse Cleanup Fetch Error:", err);
    expiredLeases.forEach((lease) => {
      connection.query(
        "UPDATE Lease SET status = 'COMPLETED' WHERE lease_id = ?",
        [lease.lease_id],
        (updErr) => {
          if (updErr) return;

          notifier.send({
            sender: "SYSTEM",
            receiver: lease.renter_id,
            type: "LEASE_COMPLETED",
            title: "Stay Completed! 🏠",
            body: `Your stay at "${lease.property_name}" has officially ended.`,
            metadata: { lease_id: lease.lease_id, type: "lease_update" },
          });
        },
      );
    });
  });

  // --- TASK 2: MONTHLY BILLING (3-Day Notice) ---
  // Added check: next_billing_date < check_out_date to stop billing at the end of the lease
  const billingSql = `
    SELECT l.lease_id, l.renter_id, l.owner_id, p.property_name, p.price_value, l.check_out_date
    FROM Lease l
    JOIN Property p ON l.property_id = p.property_id
    WHERE l.renting_type = 'MONTH' 
      AND l.status = 'IN_PROGRESS'
      AND l.next_billing_date = DATE_ADD(CURDATE(), INTERVAL 3 DAY)
      AND l.next_billing_date < l.check_out_date
  `;

  connection.query(billingSql, (err, leasesToBill) => {
    if (err) console.error("❌ Pulse Billing Error:", err);

    leasesToBill.forEach((lease) => {
      const invoiceId = crypto.randomUUID();

      connection.beginTransaction((tErr) => {
        if (tErr) return;

        const invSql = `
          INSERT INTO Invoices (invoice_id, lease_id, renter_id, amount, due_date, status)
          VALUES (?, ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'UNPAID')
        `;

        connection.query(
          invSql,
          [invoiceId, lease.lease_id, lease.renter_id, lease.price_value],
          (invErr) => {
            if (invErr) return connection.rollback();

            const updateLeaseSql = `
            UPDATE Lease SET next_billing_date = DATE_ADD(next_billing_date, INTERVAL 1 MONTH) 
            WHERE lease_id = ?
          `;

            connection.query(updateLeaseSql, [lease.lease_id], (updLErr) => {
              if (updLErr) return connection.rollback();

              connection.commit(() => {
                // Notification matches your PaymentLink and Webhook expectation
                notifier.send({
                  sender: "SYSTEM",
                  receiver: lease.renter_id,
                  type: "RENT_DUE_NOTICE",
                  title: "Rent Due in 3 Days ⏳",
                  body: `Monthly rent for "${lease.property_name}" is due soon (${lease.price_value} EGP).`,
                  metadata: {
                    invoice_id: invoiceId, // Important for GetPaymentLink
                    type: "invoice_payment",
                  },
                });
              });
            });
          },
        );
      });
    });
  });

  // --- TASK 3: START UPCOMING LEASES ---
  // If today is check_in_date, move 'UPCOMING' to 'IN_PROGRESS'
  const startLeaseSql = `UPDATE Lease SET status = 'IN_PROGRESS' WHERE status = 'UPCOMING' AND check_in_date <= CURDATE()`;
  connection.query(startLeaseSql, (err, result) => {
    if (err) console.error("❌ Pulse Activation Error:", err);
    else if (result.affectedRows > 0)
      console.log(`🚀 Activated ${result.affectedRows} leases.`);
  });

  // --- TASK 4: MARK OVERDUE INVOICES ---
  // Find invoices that are UNPAID and past their due_date
  const overdueSql = `
    SELECT i.invoice_id, i.renter_id, i.amount, l.owner_id, p.property_name 
    FROM Invoices i
    JOIN Lease l ON i.lease_id = l.lease_id
    JOIN Property p ON l.property_id = p.property_id
    WHERE i.status = 'UNPAID' AND i.due_date < CURDATE()
  `;

  connection.query(overdueSql, (err, overdueInvoices) => {
    if (err) console.error("❌ Pulse Overdue Check Error:", err);

    overdueInvoices.forEach((inv) => {
      // Update status to OVERDUE
      connection.query(
        "UPDATE Invoices SET status = 'OVERDUE' WHERE invoice_id = ?",
        [inv.invoice_id],
        (updErr) => {
          if (updErr) return;

          // 1. Notify Renter (The Warning)
          notifier.send({
            sender: "SYSTEM",
            receiver: inv.renter_id,
            type: "PAYMENT_OVERDUE",
            title: "Urgent: Payment Overdue ⚠️",
            body: `Your rent for "${inv.property_name}" (${inv.amount} EGP) is overdue. Please pay immediately to avoid lease cancellation.`,
            metadata: { invoice_id: inv.invoice_id, type: "invoice_payment" },
          });

          // 2. Notify Landlord (The Alert)
          notifier.send({
            sender: "SYSTEM",
            receiver: inv.owner_id,
            type: "TENANT_PAYMENT_FAILED",
            title: "Rent Payment Overdue 🚩",
            body: `The rent for "${inv.property_name}" has not been paid by the due date.`,
            metadata: { invoice_id: inv.invoice_id, renter_id: inv.renter_id },
          });

          console.log(`🚩 Invoice ${inv.invoice_id} marked as OVERDUE.`);
        },
      );
    });
  });

  // --- TASK 5: AUTO-CANCEL SEVERE OVERDUE ---
  const severeOverdueSql = `
  SELECT i.lease_id, l.renter_id, l.owner_id, p.property_id, p.property_name 
  FROM Invoices i
  JOIN Lease l ON i.lease_id = l.lease_id
  JOIN Property p ON l.property_id = p.property_id
  WHERE i.status = 'OVERDUE' AND i.due_date <= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
`;

  connection.query(severeOverdueSql, (err, badLeases) => {
    if (err) return console.error("❌ Pulse Severe Overdue Error:", err);

    badLeases.forEach((lease) => {
      // 1. Terminate the Lease
      connection.query(
        "UPDATE Lease SET status = 'CANCELLED' WHERE lease_id = ?",
        [lease.lease_id],
        (leaseErr) => {
          if (leaseErr)
            return console.error("❌ Failed to cancel lease:", leaseErr);

          // 2. RESET THE PROPERTY AVAILABILITY (Crucial for new bookings!)
          connection.query(
            "UPDATE Property SET status = 'AVAILABLE' WHERE property_id = ?",
            [lease.property_id],
          );

          // 3. Notify Renter (Eviction Notice)
          notifier.send({
            receiver: lease.renter_id,
            type: "LEASE_TERMINATED",
            title: "Lease Cancelled 🚫",
            body: `Your lease for "${lease.property_name}" was terminated due to non-payment.`,
          });

          // 4. Notify Landlord (Property is free again)
          notifier.send({
            receiver: lease.owner_id,
            type: "LEASE_TERMINATED",
            title: "Lease Cancelled 🔑",
            body: `Lease for "${lease.property_name}" cancelled. The property is now available for new bookings.`,
          });

          console.log(
            `🚫 Lease ${lease.lease_id} terminated due to severe overdue.`,
          );
        },
      );
    });
  });
  console.log("Pulse processed successfully");
  
  return res.status(200).json({ msg: "Pulse processed successfully" });
};

module.exports = { runRentalPulse };
