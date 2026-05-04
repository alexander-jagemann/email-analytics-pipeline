/**
 * EmailAnalyticsPipeline
 * Extracts campaign performance and list growth metrics from CRM API.
 * Anonymized for portfolio purposes.
 */

class EmailAnalyticsPipeline {
  constructor() {
    this.scriptProperties = PropertiesService.getScriptProperties();
    this.apiKey = this.scriptProperties.getProperty('CRM_API_KEY');
    this.spreadsheetId = this.scriptProperties.getProperty('TARGET_SPREADSHEET_ID');
    this.listId = this.scriptProperties.getProperty('PRIMARY_LIST_ID');
    
    if (!this.apiKey || !this.spreadsheetId) {
      throw new Error("Critical configuration missing in Script Properties.");
    }
    
    this.sheet = SpreadsheetApp.openById(this.spreadsheetId).getSheetByName('Raw_Data');
    this.baseUrl = "https://api.sendinblue.com/v3";
    this.headers = {
      "accept": "application/json",
      "api-key": this.apiKey
    };
    
    this.targetDate = new Date();
    this.targetDate.setDate(this.targetDate.getDate() - 1);
    this.dateString = Utilities.formatDate(this.targetDate, "GMT", "yyyy-MM-dd");
  }

  fetchFromAPI_(endpoint) {
    const options = {
      "method": "GET",
      "headers": this.headers,
      "muteHttpExceptions": true
    };
    const response = UrlFetchApp.fetch(`${this.baseUrl}${endpoint}`, options);
    
    if (response.getResponseCode() !== 200) {
      Logger.log(`API Error: ${response.getContentText()}`);
      return null;
    }
    return JSON.parse(response.getContentText());
  }

  syncCampaignStats(tagsArray) {
    const dataMap = new Map();

    tagsArray.forEach(tag => {
      const endpoint = `/smtp/statistics/reports?startDate=${this.dateString}&endDate=${this.dateString}&tag=${tag}`;
      const data = this.fetchFromAPI_(endpoint);

      if (!data || !data.reports || data.reports.length === 0) return;

      data.reports.forEach(report => {
        const key = new Date(report.date).toISOString().substring(0, 10);
        const values = dataMap.get(key) || new Array(10).fill(0); 
        
        values[0] = report.date;
        values[1] += report.requests;
        values[2] += report.delivered;
        values[3] += report.hardBounces;
        values[4] += report.softBounces;
        values[5] += report.clicks;
        values[6] += report.uniqueClicks;
        values[7] += report.opens;
        values[8] += report.uniqueOpens;
        values[9] += report.unsubscribed;
        
        dataMap.set(key, values);
      });
    });

    this.appendDataToSheet_(dataMap, 4);
  }

  syncListGrowth() {
    const endpoint = `/contacts/lists/${this.listId}`;
    const data = this.fetchFromAPI_(endpoint);
    
    if (data && data.totalSubscribers) {
      const lastRow = this.getCleanLastRow_();
      this.sheet.getRange(lastRow, 28).setValue(data.totalSubscribers);
    }
  }

  syncDownstreamFormulas() {
    const lastRow = this.getCleanLastRow_();
    
    const sourceRange1 = this.sheet.getRange(lastRow - 1, 15, 1, 13);
    const targetRange1 = this.sheet.getRange(lastRow, 15, 1, 13);
    sourceRange1.copyTo(targetRange1, {formulaOnly: true});

    const sourceRange2 = this.sheet.getRange(lastRow - 1, 32, 1, 3);
    const targetRange2 = this.sheet.getRange(lastRow, 32, 1, 3);
    sourceRange2.copyTo(targetRange2, {formulaOnly: true});
  }

  appendDataToSheet_(dataMap, startColumn) {
    const rows = Array.from(dataMap.values());
    if (rows.length === 0) return;

    rows.sort((a, b) => new Date(a[0]) - new Date(b[0]));
    const lastRow = this.getCleanLastRow_();
    
    this.sheet.getRange(lastRow, 1, 1, 3).copyTo(this.sheet.getRange(lastRow + 1, 1, 1, 3));
    this.sheet.getRange(lastRow + 1, startColumn, rows.length, rows[0].length).setValues(rows);
  }

  getCleanLastRow_() {
    let lastRow = this.sheet.getLastRow();
    while (lastRow > 1 && this.sheet.getRange(lastRow, 1).isBlank()) {
      lastRow--;
    }
    return lastRow;
  }
}

function executeDailyETL() {
  const pipeline = new EmailAnalyticsPipeline();
  
  const coreTags = ["campaign_welcome", "campaign_newsletter", "campaign_winback", "promo_seasonal"];
  pipeline.syncCampaignStats(coreTags);
  
  pipeline.syncListGrowth();
  pipeline.syncDownstreamFormulas();
}
