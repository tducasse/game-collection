const readCsv = (url, callback) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.onload = () => {
    if (xhr.status === 200) {
      const data = xhr.responseText;
      callback(data);
    }
  };
  xhr.send();
}

const processCsv = (response) => {
  const data = $.csv.toArrays(response);
  generateHtmlTable(data);
}

const formatSecondsDuration = (time) => {
  const hours = Math.floor(time / 3600);
  const minutes = Math.floor((time - (hours * 3600)) / 60);
  const seconds = time - (hours * 3600) - (minutes * 60);

  let result = '';
  if (hours > 0) {
    result += hours + 'h ';
  }
  if (minutes > 0) {
    result += minutes + 'm ';
  }
  result += seconds + 's';

  return result;
}


function generateHtmlTable(data) {
  var html = '<table class="display">';
  if (typeof (data[0]) === 'undefined') {
    return null;
  } else {
    $.each(data, function (index, row) {
      if (index === 0) {
        return;
      }
      //bind header
      if (index == 1) {
        html += '<thead>';
        html += '<tr>';
        $.each(row, function (j, colData) {
          html += '<th>';
          html += colData;
          html += '</th>';
        });
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';
      } else {
        html += '<tr>';
        $.each(row, function (k, colData) {
          if (k === 3) {
            html += `<td data-order="${Number(colData)}">`;
            html += formatSecondsDuration(colData);
            html += '</td>';
          } else {
            html += '<td>';
            html += colData;
            html += '</td>';
          }
        });
        html += '</tr>';
      }
    });
    html += '</tbody>';
    html += '</table>';
    $('#table').append(html);
    $('#table>table').DataTable({
      responsive: true,
      columnDefs: [
        { searchable: false, targets: [2] },
        { visible: false, targets: [2] }
      ]
    });
  }
}

$(document).ready(() => {
  readCsv('games.csv', processCsv);
});

