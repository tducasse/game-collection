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

      if (row[1] === "True") {return;}

      if (index === 1) {
        html += '<thead>';
        html += '<tr>';
        html += '<th>';
        html += "Name";
        html += '</th>';
        html += '<th>';
        html += "Completion Status";
        html += '</th>';
        html += '<th>';
        html += "Score";
        html += '</th>';
        html += '</tr>';
        html += '</thead>';
        html += '<tbody>';
      } else {
        html += '<tr>';
        html += '<td>';
        html += row[0];
        html += '</td>';
        html += '<td>';
        html += row[2];
        html += '</td>';
        html += '<td>';
        html += row[3];
        html += '</td>';
        html += '</tr>';
      }
    });
    html += '</tbody>';
    html += '</table>';
    $('#table').append(html);
    $('#table>table').DataTable({
      order: [[1, 'asc'], [2, 'desc']],
      paging: false,
      columnDefs: [
        {
          targets: 0,
          orderable: false
        },
        {
          targets:1,
          orderable: false
        },
        {
          targets: 2,
          searchable: false,
          visible: false,
        }
      ],
    });
  }
}

$(document).ready(() => {
  readCsv('games.csv', processCsv);
});

