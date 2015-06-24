/*
    Inspired by https://github.com/minrk/ipython_extensions

    Add this file to $(ipython locate)/nbextensions/github.js
    And load it with:

    require(['nbextensions/github'], function (github_extension) {
        console.log('github extension loaded');
        github_extension.load_ipython_extension();
    });

*/
define(function () {

    var repoName = 'github_repo';
    var authName = 'github_auth';

    var commitToGithub = function (repo, auth, tree) {
        var headers = {Authorization: 'token ' + auth};
        var apiUrl = 'https://api.github.com/repos/' + repo + '/git';

        var onError = function (jqXHR, status, err) {
            console.log('Push to github failed: ' + err);
            console.log(jqXHR);
            if (jqXHR.status == 401 || jqXHR.status == 403) {
                // authentication failed, delete the token
                // so that we prompt again
                delete localStorage[authName];
                commitNotebookToGithub();
            }
        };

        var doCommitToGithub = function () {
            // fetch latest commit sha
            $.ajax(apiUrl + '/trees/master', {
                type: 'GET',
                headers: headers,
                error: onError,
                success: function (data, status) {
                    pushTree(data.sha);
                }
            });
        };

        var pushTree = function (baseTree) {
            // post new tree
            $.ajax(apiUrl + '/trees', {
                type: 'POST',
                headers: headers,
                data: JSON.stringify({base_tree: baseTree, tree: tree}),
                error: onError,
                success: function (data, status) {
                    pushCommit(baseTree, data.sha);
                }
            });
        };

        var pushCommit = function (baseTree, newTree) {
            // post new commit
            var commitData = {
                message: 'pushed by github.js',
                tree: newTree,
                parents: [baseTree]
            };
            $.ajax(apiUrl + '/commits', {
                type: 'POST',
                headers: headers,
                data: JSON.stringify(commitData),
                error: onError,
                success: function (data, status) {
                    updateMasterRef(data.sha);
                }
            });
        };

        var updateMasterRef = function (ref) {
            // update master
            $.ajax(apiUrl + '/refs/heads/master', {
                type: 'PATCH',
                headers: headers,
                data: JSON.stringify({sha: ref, force: true}),
                error: onError,
                success: function (data, status) {
                    IPython.notebook.metadata.git_repo = repo;
                    var commitUrl = 'https://github.com/' + repo + '/commit/' + data.object.sha;
                    var commitLink = '<a href="' + commitUrl + '" target="_blank">' + data.object.sha + '</a>';
                    IPython.notification_area.get_widget('notebook').set_message('Committed ' + commitLink, 1500);
                }
            });
        };

        doCommitToGithub();
    };

    // dialog to request GitHub repo
    var repoDialog = function () {
        var dialog = $('<div/>').append(
            $('<p/>').html('Enter a GitHub Repo (in a <repr>:owner/:repo</repr> format):')
        ).append(
            $('<br/>')
        ).append(
            $('<input/>').attr('type', 'text').attr('size', '40')
        );
        IPython.dialog.modal({
            title: 'GitHub Repo',
            body: dialog,
            buttons: {
                'Cancel': {},
                'OK': {
                    'class': 'btn-primary',
                    'click': function () {
                        var repo = $(this).find('input').val();
                        localStorage[repoName] = repo;
                        commitNotebookToGithub();
                    }
                }
            },
            open: function (event, ui) {
                var that = $(this);
                // Upon ENTER, click the OK button.
                that.find('input[type="text"]').keydown(function (event, ui) {
                    if (event.which === 13) {
                        that.find('.btn-primary').first().click();
                        return false;
                    }
                });
                that.find('input[type="text"]').focus().select();
            }
        });
    };

    // dialog to request GitHub OAuth token
    var authDialog = function () {
        var dialog = $('<div/>').append(
            $('<p/>').html('Enter a <a href="https://github.com/settings/applications" target="_blank">GitHub OAuth Token</a>:')
        ).append(
            $('<br/>')
        ).append(
            $('<input/>').attr('type', 'text').attr('size', '40')
        );
        IPython.dialog.modal({
            title: 'GitHub OAuth',
            body: dialog,
            buttons: {
                'Cancel': {},
                'OK': {
                    'class': 'btn-primary',
                    'click': function () {
                        var auth = $(this).find('input').val();
                        localStorage[authName] = auth;
                        commitNotebookToGithub();
                    }
                }
            },
            open: function (event, ui) {
                var that = $(this);
                // Upon ENTER, click the OK button.
                that.find('input[type="text"]').keydown(function (event, ui) {
                    if (event.which === 13) {
                        that.find('.btn-primary').first().click();
                        return false;
                    }
                });
                that.find('input[type="text"]').focus().select();
            }
        });
    };

    // get the GitHub repo
    var getGithubRepo = function () {
        var repo = localStorage[repoName];
        if (!repo) {
            repo = IPython.notebook.metadata.git_repo = repo;
        }
        if (!repo) {
            repoDialog();
            return null;
        }
        return repo;
    };

    // get the GitHub auth
    var getGithubAuth = function () {
        var auth = localStorage[authName];
        if (!auth) {
            authDialog();
            return null;
        }
        return auth;
    };

    var commitNotebookToGithub = function () {
        if (!IPython.notebook) {
            return;
        }
        // dialog's are async, so we can't do anything yet.
        // the dialog OK callback will continue the process.
        var repo = getGithubRepo();
        if (!repo) {
            console.log('waiting for repo dialog');
            return;
        }
        var auth = getGithubAuth();
        if (!auth) {
            console.log('waiting for auth dialog');
            return;
        }
        var nbj = IPython.notebook.toJSON();
        if (nbj.nbformat === undefined) {
            // older IPython doesn't put nbformat in the JSON
            nbj.nbformat = IPython.notebook.nbformat;
        }
        var tree = [{
            path: IPython.notebook.notebook_path,
            content: JSON.stringify(nbj, undefined, 1),
            mode: '100644',
            type: 'blob'
        }];
        commitToGithub(repo, auth, tree);
    };

    var githubButton = function () {
        if (!IPython.toolbar) {
            $([IPython.events]).on('app_initialized.NotebookApp', githubButton);
            return;
        }
        if ($('#github-notebook').length === 0) {
            IPython.toolbar.add_buttons_group([
                {
                    'label': 'Push Notebook to GitHub',
                    'icon': 'fa-github',
                    'callback': commitNotebookToGithub,
                    'id': 'github-notebook'
                }
            ]);
        }
    };

    return {load_ipython_extension: githubButton};
});
