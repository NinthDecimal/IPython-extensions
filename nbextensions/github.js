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

    var gitRepo = null;

    var commitToGithub = function (repo, auth, tree) {
        var headers = {Authorization: 'token ' + auth};
        var apiUrl = 'https://api.github.com/repos/' + repo + '/git';

        var onError = function (jqXHR, status, err) {
            console.log('Push to github failed: ' + err);
            console.log(jqXHR);
            if (jqXHR.status === 401 || jqXHR.status === 403) {
                // authentication failed, delete the token
                // so that we prompt again
                delete localStorage.githubAuth;
                doCommitNotebookToGithub();
            } else {
                var widget = IPython.notification_area.get_widget('notebook');
                widget.set_message('Push to GitHub failed: ' + err, 3000);
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
                    // write the repo to metadata
                    IPython.notebook.metadata.git_repo = repo;
                    var commitUrl = 'https://github.com/' + repo + '/commit/' + data.object.sha;
                    var commitLink = '<a href="' + commitUrl + '" target="_blank">' + data.object.sha + '</a>';
                    var widget = IPython.notification_area.get_widget('notebook');
                    widget.set_message('Committed', 3000);
                    widget.inner.html('Committed ' + commitLink);
                }
            });
        };

        doCommitToGithub();
    };

    // dialog to request GitHub repo
    var repoDialog = function (repo) {
        var dialog = $('<div/>').append(
            $('<p/>')
                .addClass('repo-message')
                .html('Enter a GitHub Repo (in a <repr>:owner/:repo</repr> format):')
        ).append(
            $('<br/>')
        ).append(
            $('<input/>')
                .addClass('form-control')
                .attr('type', 'text')
                .attr('size', '25')
                .val(repo)
        );
        var d = IPython.dialog.modal({
            title: 'GitHub Repo',
            body: dialog,
            keyboard_manager: IPython.notebook.keyboard_manager,
            buttons: {
                'OK': {
                    'class': 'btn-primary',
                    'click': function () {
                        var repo = d.find('input').val();
                        if (repo.split('/').length !== 2) {
                            d.find('.repo-message').html(
                                'Invalid Repo. Repo must be in <repr>:owner/:repo</repr> format. ' +
                                'Enter a GitHub Repo (in a <repr>:owner/:repo</repr> format):'
                            );
                            return false;
                        } else {
                            gitRepo = repo;
                            doCommitNotebookToGithub();
                        }
                    }
                },
                'Cancel': {}
            },
            open: function () {
                // make sure "shortcut mode" is disabled
                IPython.notebook.keyboard_manager.enabled = false;
                // Upon ENTER, click the OK button.
                d.find('input[type="text"]').keydown(function (event) {
                    if (event.which === IPython.keyboard.keycodes.enter) {
                        d.find('.btn-primary').first().click();
                        return false;
                    }
                });
                d.find('input[type="text"]').focus().select();
            }
        });
    };

    // dialog to request GitHub OAuth token
    var authDialog = function () {
        var dialog = $('<div/>').append(
            $('<p/>')
                .addClass('auth-message')
                .html('Enter a <a href="https://github.com/settings/applications" target="_blank">GitHub OAuth Token</a>:')
        ).append(
            $('<br/>')
        ).append(
            $('<input/>')
                .addClass('form-control')
                .attr('type', 'text')
                .attr('size', '25')
        );
        var d = IPython.dialog.modal({
            title: 'GitHub Auth',
            body: dialog,
            keyboard_manager: IPython.notebook.keyboard_manager,
            buttons: {
                'OK': {
                    'class': 'btn-primary',
                    'click': function () {
                        localStorage.githubAuth = $(this).find('input').val();
                        doCommitNotebookToGithub();
                    }
                },
                'Cancel': {}
            },
            open: function () {
                // make sure "shortcut mode" is disabled
                IPython.notebook.keyboard_manager.enabled = false;
                // Upon ENTER, click the OK button.
                d.find('input[type="text"]').keydown(function (event) {
                    if (event.which === IPython.keyboard.keycodes.enter) {
                        d.find('.btn-primary').first().click();
                        return false;
                    }
                });
                d.find('input[type="text"]').focus().select();
            }
        });
    };

    // get the GitHub repo
    var getGithubRepo = function () {
        repo = gitRepo;
        if (!repo) {
            repoDialog(IPython.notebook.metadata.git_repo);
            return null;
        }
        return repo;
    };

    // get the GitHub auth
    var getGithubAuth = function () {
        var auth = localStorage.githubAuth;
        if (!auth) {
            authDialog();
            return null;
        }
        return auth;
    };

    var doCommitNotebookToGithub = function () {
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

    var commitNotebookToGithub = function () {
        if (!IPython.notebook) {
            return;
        }
        // reset gitRepo to force repo dialog
        gitRepo = null;
        doCommitNotebookToGithub();
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
