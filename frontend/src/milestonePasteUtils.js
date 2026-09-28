export function splitDelimitedLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      const nextCharacter = line[index + 1];
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if ((character === ',' || character === '\t' || character === ';') && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells.filter((cell) => cell !== '');
}

function looksLikeDate(value) {
  return /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Spreadsheet paste sources use the Australian D/M/Y convention (e.g. "30/9/2026"); normalise
// to ISO (YYYY-MM-DD) so stored dates match every other date field in the app, and so
// `new Date(...)` on the backend doesn't misread the day as a month and silently discard the row.
function normaliseDateToIso(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (isoMatch) return text;

  const dayMonthYearMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (!dayMonthYearMatch) return text;

  const [, dayText, monthText, yearText] = dayMonthYearMatch;
  const year = yearText.length === 2 ? `20${yearText}` : yearText;
  const day = dayText.padStart(2, '0');
  const month = monthText.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function looksLikeAmount(value) {
  const cleaned = value.replace(/[$€£,]/g, '').trim();
  return /^\d+(?:\.\d+)?$/.test(cleaned);
}

function looksLikeTermDays(value) {
  return /^\d{1,3}$/.test(value.trim());
}

function normaliseBoolean(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'included', 'active'].includes(text)) return true;
  if (['false', 'no', 'n', '0', 'excluded', 'inactive'].includes(text)) return false;
  return Boolean(value);
}

export function parseEmployeePasteRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const cells = splitDelimitedLine(line).map((cell) => cell.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
      if (!cells.length) return null;
      const isHeader = ['name', 'employee', 'person'].includes((cells[0] || '').trim().toLowerCase());
      if (isHeader) return null;

      const row = {
        id: `paste-${Date.now()}-${index}`,
        name: cells[0] || '',
        payType: 'fixed_cycle',
        employmentType: 'payg',
        paymentMethod: 'payroll',
        payFrequency: 'fortnightly',
        payAmount: '',
        dayRate: '',
        daysWorkedPerWeek: '',
        state: 'QLD',
        included: true,
      };

      const payTypeValue = (cells[1] || '').toLowerCase();
      if (['day', 'day rate', 'day_rate', 'daily', 'daily rate'].includes(payTypeValue)) row.payType = 'day_rate';
      if (['fixed', 'fixed cycle', 'salary', 'annual salary', 'fixed_cycle'].includes(payTypeValue)) row.payType = 'fixed_cycle';

      const employmentTypeValue = cells.find((cell) => ['payg', 'contractor'].includes(cell.toLowerCase()));
      if (employmentTypeValue) row.employmentType = employmentTypeValue.toLowerCase();

      const paymentMethodValue = cells.find((cell) => ['payroll', 'invoice'].includes(cell.toLowerCase()));
      if (paymentMethodValue) row.paymentMethod = paymentMethodValue.toLowerCase();

      const payFrequencyValue = cells.find((cell) => ['weekly', 'fortnightly', 'biweekly', '2-weekly', 'monthly', 'month'].includes(cell.toLowerCase())) || '';
      if (['weekly'].includes(payFrequencyValue)) row.payFrequency = 'weekly';
      if (['fortnightly', 'biweekly', '2-weekly'].includes(payFrequencyValue)) row.payFrequency = 'fortnightly';
      if (['monthly', 'month'].includes(payFrequencyValue)) row.payFrequency = 'monthly';

      const numericCandidates = cells
        .map((cell) => cell.trim())
        .filter((cell) => /^\d+(?:\.\d+)?$/.test(cell.replace(/[$,]/g, '')) || /^\d+(?:\.\d+)?$/.test(cell));

      if (row.payType === 'day_rate') {
        row.dayRate = numericCandidates[0] || '';
        row.daysWorkedPerWeek = numericCandidates[1] || '';
      } else {
        row.payAmount = numericCandidates[0] || '';
      }

      const stateMatch = cells.find((cell) => ['QLD', 'NSW', 'VIC', 'WA', 'SA', 'ACT', 'TAS', 'NT'].includes((cell || '').trim().toUpperCase()));
      if (stateMatch) row.state = stateMatch.trim().toUpperCase();

      const includedCell = cells.find((cell) => ['true', 'false', 'yes', 'no', 'y', 'n', '1', '0', 'included', 'excluded'].includes((cell || '').trim().toLowerCase()));
      if (includedCell) row.included = normaliseBoolean(includedCell);

      return row;
    })
    .filter(Boolean);
}

export function parsePastedRows(text, clientLookup = new Map()) {
  const clientNames = [...clientLookup.keys()].sort((a, b) => b.length - a.length);

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const rawCells = splitDelimitedLine(line).map((cell) => cell.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
      const whitespaceTokens = line.split(/\s+/).filter(Boolean);
      const tokens = rawCells.length > 1 ? rawCells : whitespaceTokens;

      const matchedClient = clientNames.find((name) => {
        const candidate = tokens.join(' ');
        return candidate.toLowerCase().startsWith(name.toLowerCase());
      });

      let remainingTokens = [...tokens];
      let clientName = tokens[0] || '';
      if (matchedClient) {
        const rawFirstCell = rawCells[0] || '';
        if (rawFirstCell && rawFirstCell.toLowerCase() === matchedClient.toLowerCase()) {
          clientName = rawFirstCell;
          remainingTokens = rawCells.slice(1);
        } else {
          const clientWords = matchedClient.split(/\s+/).length;
          clientName = tokens.slice(0, clientWords).join(' ');
          const joined = tokens.join(' ');
          const trimmed = joined.replace(new RegExp(`^${matchedClient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').trim();
          remainingTokens = trimmed ? trimmed.split(/\s+/) : [];
        }
      }

      const resolvedClient = clientLookup.get(clientName.toLowerCase());

      const cleanedTokens = remainingTokens
        .map((token) => token.trim())
        .filter((token) => token && token !== ',');

      let paymentTermDays = '14';
      const termIndex = [...cleanedTokens].findLastIndex((token) => looksLikeTermDays(token));
      if (termIndex >= 0) {
        paymentTermDays = cleanedTokens[termIndex];
      }

      let invoiceDate = '';
      let invoiceDateIndex = -1;
      for (let i = cleanedTokens.length - 1; i >= 0; i -= 1) {
        if (looksLikeDate(cleanedTokens[i]) && (termIndex < 0 || i < termIndex)) {
          invoiceDateIndex = i;
          invoiceDate = normaliseDateToIso(cleanedTokens[i]);
          break;
        }
      }

      let amount = '';
      let amountIndex = -1;
      const upperBound = invoiceDateIndex >= 0 ? invoiceDateIndex : (termIndex >= 0 ? termIndex : cleanedTokens.length);
      for (let i = upperBound - 1; i >= 0; i -= 1) {
        if (looksLikeAmount(cleanedTokens[i])) {
          amount = cleanedTokens[i].replace(/[$€£,]/g, '');
          amountIndex = i;
          break;
        }
      }

      let milestoneNumber = '1';
      for (let i = 0; i < cleanedTokens.length; i += 1) {
        if (/^\d+$/.test(cleanedTokens[i]) && i !== termIndex && i !== amountIndex && i !== invoiceDateIndex && cleanedTokens[i] !== paymentTermDays) {
          milestoneNumber = cleanedTokens[i];
          break;
        }
      }

      const descriptionTokens = cleanedTokens.filter((token, tokenIndex) => {
        const trimmed = token.trim();
        if (!trimmed) return false;
        if (tokenIndex === termIndex || tokenIndex === amountIndex || tokenIndex === invoiceDateIndex) return false;
        if (looksLikeTermDays(trimmed) || looksLikeAmount(trimmed) || looksLikeDate(trimmed)) return false;
        if (/^\d+$/.test(trimmed) && trimmed === milestoneNumber) return false;
        return true;
      });

      const projectDescription = descriptionTokens.join(' ');

      return {
        id: `paste-${Date.now()}-${index}`,
        clientName: clientName || '',
        projectDescription: projectDescription || '',
        milestoneNumber: milestoneNumber || '1',
        amount: amount || '',
        invoiceDate: invoiceDate || '',
        paymentTermDays: paymentTermDays || '14',
        clientId: resolvedClient ? resolvedClient.id : '',
        isValid: Boolean(resolvedClient),
        error: resolvedClient ? '' : 'Client not found in configured list',
      };
    });
}
