
class KashierPaymentService {
  constructor(
    sec_key,
    api_key,
    merchantId,
    merchantRedirect,
    webhook,
    url = "https://test-api.kashier.io/v3",
  ) {
    this.sec_key = sec_key;
    this.api_key = api_key;
    this.merchantId = merchantId;
    this.url = url;
    this.merchantRedirect = merchantRedirect;
    this.webhook = webhook;
  }

  createPaymentSession = (amount, customer, currency = "EGP",order_id="test") => {
    const orderId = order_id;

    const req_data = {
      amount: amount.toString(),
      currency: currency,
      order: orderId,
      expireAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours after payment is created
      merchantId: this.merchantId,
      display: "en",
      serverWebhook: this.webhook,
      merchantRedirect: this.merchantRedirect,

      type: "one-time",
      allowedMethods: "card,wallet",
      redirectMethod: "get",
      iframeBackgroundColor: "#FFFFFF",
      failureRedirect: false,
      description: `Payment for order ${orderId}`,
      manualCapture: false,
      customer: {
        email: customer.email,
        reference: customer.reference, // rent_request_id
      },
    };

    return req_data;
  };

  sendPaymentRequest = async (req_data) => {
    try {
      const response = await fetch(this.url + "/payment/sessions", {
        method: "POST",
        headers: {
          Authorization: this.sec_key,
          "api-key": this.api_key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req_data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Kashier API Error:", errorData);
        return errorData;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Network or System Error:", error);
      throw error;
    }
  };

  sendRefundRequest = async (amount, orderId, reason = "not reason") => {
    const url = `https://test-fep.kashier.io/v3/orders/${orderId}`;
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: this.sec_key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiOperation: "REFUND",
          reason: reason,
          transaction: {
            amount: amount,
          },
        }),
      });
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Network or System Error:", error);
      throw error;
    }
  };

  getAccountBalance = async () => {
    const url = "https://test-api.kashier.io/v2/account";
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: this.sec_key },
      });
      return await response.json();
    } catch (error) {
      console.error("Balance Check Error:", error);
    }
  };

  sendMoney = async (amount, type, receiverData) => {
  const url = "https://test-fep.kashier.io/v3/transfers/single";

  // 1. Validation for Wallets
  if (type === "wallet" && !receiverData.number.startsWith("01")) {
    throw new Error("Invalid Egyptian wallet number. Must start with 01.");
  }

  // 2. Build Dynamic Payload
  const payload = {
    amount: amount,
    method: type,
    recipientName: receiverData.name,
    recipientNumber: receiverData.number,
    merchantTransferId: `TR-${Date.now()}`,
  };

  // 3. Only add recipientBank if it's NOT a wallet
  if (type !== "wallet" && receiverData.recipientBank) {
    payload.recipientBank = receiverData.recipientBank;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.sec_key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return await response.json();
  } catch (error) {
    console.error(`Payout to ${type} failed:`, error);
    throw error; 
  }
};

  getTransferStatus = async (transferId) => {
  const url = `https://test-api.kashier.io/v2/transfers/${transferId}`;
  
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": this.sec_key,
        "Content-Type": "application/json"
      }
    });
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error("Error fetching transfer status:", error);
    throw error;
  }
};


}

module.exports = { KashierPaymentService };
