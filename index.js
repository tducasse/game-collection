const readCsv = (url, callback) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.onload = () => {
    if (xhr.status === 200) {
      callback(xhr.responseText);
    }
  };
  xhr.send();
};

const processCsv = (response) => {
  const data = $.csv.toArrays(response);
  generateHtmlTable(data);
};

function generateHtmlTable(data) {
  if (!data || data.length === 0) return;

  let html = `
    <table class="display">
      <thead>
        <tr>
          <th>Name</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    // Skip hidden rows
    if (row[1]?.toLowerCase() === "true") continue;

    html += `<tr><td>${row[0]}</td></tr>`;
  }

  html += `
      </tbody>
    </table>
  `;

  $('#table').append(html);

  $('#table table').DataTable({
    paging: false
  });
}

$(document).ready(() => {
  readCsv('games.csv', processCsv);
});