const connection = require("../DB");
const crypto = require("crypto");

const runRentalPulse = (req, res) => {
  const notifier = req.app.get("notifier");

  // --- TASK 1: COMPLETED LEASES (Cleanup) ---
  const expiredSql = `
    SELECT l.lease_id, l.renter_id, l.owner_id, p.property_name, p.property_id
    FROM lease l
    JOIN property p ON l.property_id = p.property_id
    WHERE l.check_out_date < CURDATE() AND l.status = 'IN_PROGRESS'
  `;

  connection.query(expiredSql, (err, expiredLeases) => {
    if (err) console.error("❌ Pulse Cleanup Fetch Error:", err);
    expiredLeases.forEach((lease) => {
      connection.query(
        "UPDATE lease SET status = 'COMPLETED' WHERE lease_id = ?",
        [lease.lease_id],
        (updErr) => {
          if (updErr) return;

          notifier.send({
            sender: "SYSTEM",
            receiver: lease.renter_id,
            type: "LEASE_COMPLETED",
            title: "Stay Completed! 🏠",
            body: `Your stay at "${lease.property_name}" has officially ended.`,
            metadata: { lease_id: lease.lease_id, property_id: lease.property_id, type: "lease_update" },
          });
        },
      );
    });
  });

  // --- TASK 2: MONTHLY BILLING (3-Day Notice) ---
  // Added check: next_billing_date < check_out_date to stop billing at the end of the lease
  const billingSql = `
    SELECT l.lease_id, l.renter_id, l.owner_id, p.property_name, p.price_value, l.check_out_date
    FROM lease l
    JOIN property p ON l.property_id = p.property_id
    WHERE l.renting_type = 'MONTH' 
      AND l.status = 'IN_PROGRESS'
      AND l.next_billing_date = DATE_ADD(CURDATE(), INTERVAL 3 DAY)
      AND l.next_billing_date < l.check_out_date
  `;

  connection.query(billingSql, (err, leasesToBill) => {
    if (err) console.error("❌ Pulse Billing Error:", err);

    leasesToBill.forEach((lease) => {
      const invoiceId = crypto.randomUUID();

      connection.query(
        "INSERT INTO invoices (invoice_id, lease_id, renter_id, owner_id, amount, due_date, status) VALUES (?, ?, ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 3 DAY), 'UNPAID')",
        [invoiceId, lease.lease_id, lease.renter_id, lease.owner_id, lease.price_value],
        (invErr) => {
          if (invErr) return console.error("❌ Pulse billing insert error:", invErr);

          connection.query(
            "UPDATE lease SET next_billing_date = DATE_ADD(next_billing_date, INTERVAL 1 MONTH) WHERE lease_id = ?",
            [lease.lease_id],
            (updLErr) => {
              if (updLErr) return console.error("❌ Pulse billing update error:", updLErr);

              notifier.send({
                sender: "SYSTEM",
                receiver: lease.renter_id,
                type: "RENT_DUE_NOTICE",
                title: "Rent Due in 3 Days ⏳",
                body: `Monthly rent for "${lease.property_name}" is due soon (${lease.price_value} EGP).`,
                metadata: {
                  invoice_id: invoiceId,
                  type: "invoice_payment",
                },
              });
            },
          );
        },
      );
    });
  });

  // --- TASK 3: START UPCOMING LEASES ---
  // If today is check_in_date, move 'UPCOMING' to 'IN_PROGRESS'
  const startLeaseSql = `UPDATE lease SET status = 'IN_PROGRESS' WHERE status = 'UPCOMING' AND check_in_date <= CURDATE()`;
  connection.query(startLeaseSql, (err, result) => {
    if (err) console.error("❌ Pulse Activation Error:", err);
    else if (result.affectedRows > 0)
      console.log(`🚀 Activated ${result.affectedRows} leases.`);
  });

  // --- TASK 4: MARK OVERDUE INVOICES ---
  // Find invoices that are UNPAID and past their due_date
  const overdueSql = `
    SELECT i.invoice_id, i.renter_id, i.amount, l.owner_id, p.property_name 
    FROM invoices i
    JOIN lease l ON i.lease_id = l.lease_id
    JOIN property p ON l.property_id = p.property_id
    WHERE i.status = 'UNPAID' AND i.due_date < CURDATE()
  `;

  connection.query(overdueSql, (err, overdueInvoices) => {
    if (err) console.error("❌ Pulse Overdue Check Error:", err);

    overdueInvoices.forEach((inv) => {
      // Update status to OVERDUE
      connection.query(
        "UPDATE invoices SET status = 'OVERDUE' WHERE invoice_id = ?",
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
  FROM invoices i
  JOIN lease l ON i.lease_id = l.lease_id
  JOIN property p ON l.property_id = p.property_id
  -- ONLY find overdue invoices where the lease is still IN_PROGRESS
  WHERE i.status = 'OVERDUE' 
    AND l.status = 'IN_PROGRESS' 
    AND i.due_date <= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
`;

  connection.query(severeOverdueSql, (err, badLeases) => {
    if (err) return console.error("❌ Pulse Severe Overdue Error:", err);

    badLeases.forEach((lease) => {
      // 1. Terminate the lease
      connection.query(
        "UPDATE lease SET status = 'CANCELLED' WHERE lease_id = ?",
        [lease.lease_id],
        (leaseErr) => {
          if (leaseErr)
            return console.error("❌ Failed to cancel lease:", leaseErr);

          // 2. RESET THE PROPERTY AVAILABILITY (Crucial for new bookings!)
          connection.query(
            // NEW CORRECT LINE
            "UPDATE property SET is_available = TRUE WHERE property_id = ?",
            [lease.property_id],
          );

          // 3. Notify Renter (Eviction Notice)
          notifier.send({
            receiver: lease.renter_id,
            type: "LEASE_TERMINATED",
            title: "lease Cancelled 🚫",
            body: `Your lease for "${lease.property_name}" was terminated due to non-payment.`,
          });

          // 4. Notify Landlord (property is free again)
          notifier.send({
            receiver: lease.owner_id,
            type: "LEASE_TERMINATED",
            title: "lease Cancelled 🔑",
            body: `lease for "${lease.property_name}" cancelled. The property is now available for new bookings.`,
          });

          console.log(
            `🚫 lease ${lease.lease_id} terminated due to severe overdue.`,
          );
        },
      );
    });
  });

  // --- TASK 6: LISTING EXPIRY NOTIFICATION ---
  const expiryWarningSql = `
    SELECT property_id, owner_id, property_name, listing_expiry
    FROM property
    WHERE property_type = 'for_sale'
      AND listing_status = 'active'
      AND DATE(listing_expiry) = DATE_ADD(CURDATE(), INTERVAL 3 DAY)
  `;
  connection.query(expiryWarningSql, (err, warningListings) => {
    if (err) console.error("❌ Pulse Listing Expiry Warning Error:", err);
    if (warningListings) {
      warningListings.forEach((prop) => {
        notifier.send({
          sender: "SYSTEM",
          receiver: prop.owner_id,
          type: "LISTING_EXPIRY_WARNING",
          title: "property Listing Expiring Soon ⏳",
          body: `Your listing for "${prop.property_name}" will expire in 3 days. Please renew to keep it visible.`,
          metadata: { property_id: prop.property_id, type: "listing_renewal" },
        });
      });
    }
  });

  // --- TASK 7: EXPIRE LISTINGS ---
  const expireListingsSql = `
    SELECT property_id, owner_id, property_name
    FROM property
    WHERE property_type = 'for_sale'
      AND listing_status = 'active'
      AND DATE(listing_expiry) < CURDATE()
  `;
  connection.query(expireListingsSql, (err, expiredListings) => {
    if (err) console.error("❌ Pulse Expire Listings Error:", err);
    if (expiredListings) {
      expiredListings.forEach((prop) => {
        connection.query(
          "UPDATE property SET listing_status = 'expired' WHERE property_id = ?",
          [prop.property_id],
          (updErr) => {
            if (updErr) return;
            notifier.send({
              sender: "SYSTEM",
              receiver: prop.owner_id,
              type: "LISTING_EXPIRED",
              title: "property Listing Expired 🚫",
              body: `Your listing for "${prop.property_name}" has expired and is no longer visible to buyers.`,
              metadata: { property_id: prop.property_id },
            });
          },
        );
      });
    }
  });

  // --- TASK 8: EXPIRE FINISHED PROMOTIONS ---
  // Flip is_active to FALSE for any promotion that has reached its end_date
  const expirePromoSql = `
    SELECT sl.promotion_id, sl.property_id, p.owner_id, p.property_name 
    FROM sponsored_listings sl
    JOIN property p ON sl.property_id = p.property_id
    WHERE sl.end_date < NOW() AND sl.is_active = TRUE
  `;

  connection.query(expirePromoSql, (err, expired) => {
    if (err) console.error("❌ Pulse Expiry Fetch Error:", err);
    expired.forEach((promo) => {
      connection.query(
        "UPDATE sponsored_listings SET is_active = FALSE WHERE promotion_id = ?",
        [promo.promotion_id],
        (updErr) => {
          if (updErr) return;
          notifier.send({
            receiver: promo.owner_id,
            type: "PROMOTION_EXPIRED",
            title: "Promotion Ended 🚀",
            body: `The promotion for "${promo.property_name}" has ended.`,
            metadata: { property_id: promo.property_id },
          });
          console.log(`📉 Deactivated Promotion ID: ${promo.promotion_id}`);
        },
      );
    });
  });

  // --- TASK 9: ACTIVATE STACKED PROMOTIONS ---
  // If a promotion was "Queued" (is_paid=TRUE but is_active=FALSE)
  // and its start_date has arrived, turn it on now.
  const activateStackedSql = `
    UPDATE sponsored_listings 
    SET is_active = TRUE 
    WHERE is_paid = TRUE 
      AND is_active = FALSE 
      AND start_date <= NOW() 
      AND end_date > NOW()
  `;

  connection.query(activateStackedSql, (err, result) => {
    if (err) console.error("❌ Pulse Activation Error:", err);
    else if (result.affectedRows > 0) {
      console.log(
        `🚀 Sentinel: Activated ${result.affectedRows} stacked promotion(s).`,
      );
    }
  });

  // --- TASK 10: PURGE ABANDONED (GHOST) REQUESTS ---
  // Delete records that were never paid and are older than 24 hours
  const purgeGhostSql = `
    DELETE FROM sponsored_listings 
    WHERE is_paid = FALSE 
    AND start_date < DATE_SUB(NOW(), INTERVAL 24 HOUR)
  `;

  connection.query(purgeGhostSql, (err, result) => {
    if (err) console.error("❌ Pulse Ghost Purge Error:", err);
    else if (result.affectedRows > 0) {
      console.log(
        `🧹 Sentinel: Purged ${result.affectedRows} abandoned requests.`,
      );
    }
  });

  // console.log("Pulse processed successfully");

  return res.status(200).json({ msg: "Pulse processed successfully" });
};

module.exports = { runRentalPulse };
